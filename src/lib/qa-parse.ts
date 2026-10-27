// 题库解析核心：分块、归一化、校验、去重、题号扫描、文末答案键解析（仅服务端）
import { ParsedQuestion, QuestionOption, QuestionType, isQuestionType, normalizeStem } from './types'

// ---------- 分块 ----------
// 目标：按题目边界切块（题号行/空行优先），控制单块大小，
// 避免 LLM 输出过长导致 JSON 截断丢题（“识别少太多”的根因之一）
const CHUNK_TARGET = 1800
const CHUNK_MAX = 2600

// 匹配以数字编号开头的题干行，如 "12. " "36、" "57）" "90) "
const STEM_LINE_RE = /^\s{0,6}(\d{1,3})\s*[.、,，．)）:：]\s*(?!\d*[.、．)）])\S/

export function findStemLines(text: string): Array<{ no: number; start: number; end: number }> {
  const lines: Array<{ no: number; start: number; end: number }> = []
  let pos = 0
  for (const line of text.split('\n')) {
    const m = line.match(STEM_LINE_RE)
    if (m) {
      const no = parseInt(m[1], 10)
      // 排除答案行（如 "9、答案："）等非题干编号行
      const rest = line
        .replace(/^\s{0,6}\d{1,3}\s*[.、,，．)）:：]\s*/, '')
        .trim()
      const isAnswerLine = /^(答案|答|解|解析)[:：]?$/.test(rest) || /^(参考)?答案/.test(rest)
      if (no >= 1 && no <= 300 && !isAnswerLine) {
        lines.push({ no, start: pos, end: pos + line.length })
      }
    }
    pos += line.length + 1
  }
  return lines
}

export function countStemLines(seg: string): number {
  return findStemLines(seg).length
}

// 统计带空括号（    ）的条目行数：用于估计无编号判断/填空题的期望题数
const BLANK_MARKER_RE = /[（(]\s{2,}[)）]/
const OPTION_LINE_RE = /^\s{0,6}[A-Ha-h][.、,，．)）:：]/

export function countItemLines(seg: string): number {
  let n = 0
  for (const line of seg.split('\n')) {
    if (!line.trim()) continue
    if (OPTION_LINE_RE.test(line)) continue
    if (BLANK_MARKER_RE.test(line)) n++
  }
  return n
}

interface LineMark {
  start: number
  kind: 'stem' | 'empty' | 'option' | 'other'
}

function lineMarks(text: string): LineMark[] {
  const marks: LineMark[] = []
  let pos = 0
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trimStart()
    let kind: LineMark['kind'] = 'other'
    if (!trimmed.trim()) kind = 'empty'
    else if (STEM_LINE_RE.test(rawLine)) kind = 'stem'
    else if (OPTION_LINE_RE.test(trimmed)) kind = 'option'
    marks.push({ start: pos, kind })
    pos += rawLine.length + 1
  }
  return marks
}

// 将全文切分为若干片段：优先在题号行/空行处切，保证不把一道题从中间切断
export function chunkByQuestion(text: string): Array<{ start: number; end: number }> {
  const total = text.length
  if (total <= CHUNK_MAX) return [{ start: 0, end: total }]
  const marks = lineMarks(text)
  const preferred = marks.filter((m) => m.kind === 'stem' || m.kind === 'empty').map((m) => m.start)
  const fallback = marks.filter((m) => m.kind === 'other').map((m) => m.start)

  const pickLargest = (list: number[], lo: number, hi: number): number => {
    let best = -1
    for (const s of list) {
      if (s > lo && s <= hi && s > best) best = s
    }
    return best
  }

  const chunks: Array<{ start: number; end: number }> = []
  let cur = 0
  while (total - cur > CHUNK_MAX) {
    const soft = cur + CHUNK_TARGET
    const hard = cur + CHUNK_MAX
    let cut = pickLargest(preferred, cur, soft)
    if (cut === -1) cut = pickLargest(fallback, cur, soft)
    if (cut === -1) cut = pickLargest(preferred, cur, hard)
    if (cut === -1) cut = pickLargest(fallback, cur, hard)
    if (cut === -1) cut = hard
    chunks.push({ start: cur, end: cut })
    cur = cut
  }
  if (cur < total) chunks.push({ start: cur, end: total })
  return chunks.filter((c) => c.end - c.start > 20)
}

// ---------- 抽取结果归一化与校验 ----------
const OPT_KEY_RE = /^[A-Ha-h]$/

function normType(v: unknown): QuestionType | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (isQuestionType(s)) return s
  if (/^(单选|选择题|single.?choice|choice)$/.test(s)) return 'single'
  if (/^(判断|是非|true.?false|judge|boolean)$/.test(s)) return 'judge'
  if (/^(填空|blank|fill)$/.test(s)) return 'blank'
  if (/^(简答|问答|论述|short|essay|question)$/.test(s)) return 'short'
  return null
}

export function normalizeJudgeAnswer(a: string): string {
  const s = a.trim()
  if (!s) return ''
  if (/^(对|正确|是|√|✓|T|true|yes|Y|A)$/i.test(s)) return '正确'
  if (/^(错|错误|不对|不正确|否|×|✗|x|F|false|no|N|B)$/i.test(s)) return '错误'
  if (s.includes('正确') || s.includes('对')) return '正确'
  if (s.includes('错误') || s.includes('错') || s.includes('否')) return '错误'
  return s
}

// 结构校验 + 修复。返回 null 表示无法挽救（如题干为空/答案区杂项）
export function normalizeQuestion(raw: unknown): ParsedQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const stem = String(obj.stem ?? obj.question ?? obj.title ?? '').trim()
  if (stem.length < 3) return null
  // 过滤分区标题与答案区杂项，避免它们被当成题目
  if (/^[（(][一二三四五六七八九十][)）]/.test(stem)) return null
  if (/^(\d{1,3}\s*[.、,，．)）:：]?\s*)?(参考)?答案[:：]?\s*$/.test(stem)) return null

  const type = normType(obj.type)
  if (!type) return null

  let options: QuestionOption[] = []
  if (type === 'single') {
    const rawOpts = obj.options ?? obj.choices
    if (Array.isArray(rawOpts)) {
      options = rawOpts
        .map((o) => {
          if (o && typeof o === 'object') {
            const key = String((o as Record<string, unknown>).key ?? '').trim()
            const text = String((o as Record<string, unknown>).text ?? (o as Record<string, unknown>).content ?? '').trim()
            return { key: key.toUpperCase(), text }
          }
          const s = String(o).trim()
          const m = s.match(/^\(?([A-Ha-h])\)?[.、,，．:：)]?\s*([\s\S]+)$/)
          if (m) return { key: m[1].toUpperCase(), text: m[2].trim() }
          return { key: '', text: s }
        })
        .filter((o) => o.text.length > 0)
        .map((o, i) => ({ key: OPT_KEY_RE.test(o.key) ? o.key : String.fromCharCode(65 + i), text: o.text }))
    }
    // 选项质量过低则降级为简答，避免丢失题目
    if (options.length < 2) {
      return { type: 'short', stem, options: [], answer: '', explanation: '' }
    }
  }

  let answer = String(obj.answer ?? obj.ans ?? '').trim()
  if (type === 'single') {
    const m = answer.toUpperCase().match(/\b([A-H])\b/) || answer.toUpperCase().match(/^([A-H])/)
    answer = m ? m[1] : answer.replace(/[^A-Ha-h]/g, '').slice(0, 1).toUpperCase()
    // 答案键不存在于选项中时清空，避免误导
    if (answer && !options.some((o) => o.key === answer)) answer = ''
  } else if (type === 'judge') {
    answer = normalizeJudgeAnswer(answer)
  }

  const explanation = String(obj.explanation ?? obj.analysis ?? obj.jiexi ?? '').trim()
  return { type, stem: stem.replace(/\s+/g, ' ').trim(), options, answer, explanation }
}

// ---------- 去重 ----------
export function dedupeQuestions(questions: ParsedQuestion[]): {
  result: ParsedQuestion[]
  removed: number
} {
  const seen = new Map<string, ParsedQuestion>()
  let removed = 0
  for (const q of questions) {
    const key = `${q.type}|${normalizeStem(q.stem).slice(0, 80)}`
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, q)
      continue
    }
    removed++
    // 保留信息更完整的一条
    const score = (x: ParsedQuestion) => (x.answer ? 2 : 0) + (x.explanation ? 1 : 0)
    if (score(q) > score(prev)) seen.set(key, q)
  }
  return { result: Array.from(seen.values()), removed }
}

// ---------- 题号扫描（用于精准补扫遗漏） ----------
// 从已识别题目中提取题号（题干以 "12." 开头时）
export function extractStemNumber(stem: string): number | null {
  const m = stem.match(/^\s*(\d{1,3})\s*[.、,，．)）:：]/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 300 ? n : null
}

// 计算缺失题号：以全文题号行与已识别题干的前缀比对（防止 LLM 自行编号造成误判）
export function findMissingNumbers(
  text: string,
  questions: ParsedQuestion[]
): Array<{ no: number; start: number; end: number }> {
  const stems = findStemLines(text)
  if (stems.length === 0) return []
  const byNo = new Map<number, { no: number; start: number }>()
  for (const s of stems) {
    if (!byNo.has(s.no)) byNo.set(s.no, s) // 同号保留首个（真题干）出现位置
  }
  const known = new Set<number>()
  for (const q of questions) {
    const n = extractStemNumber(q.stem)
    if (n === null) continue
    const s = byNo.get(n)
    if (!s) continue
    const origPrefix = normalizeStem(text.slice(s.start, s.start + 60)).slice(0, 16)
    const qPrefix = normalizeStem(q.stem).slice(0, 16)
    if (
      origPrefix.slice(0, 10) === qPrefix.slice(0, 10) ||
      origPrefix.startsWith(qPrefix.slice(0, 10)) ||
      qPrefix.startsWith(origPrefix.slice(0, 10))
    ) {
      known.add(n)
    }
  }
  const maxNo = Math.max(...stems.map((s) => s.no))
  if (maxNo < 5 || known.size === 0) return []
  const ordered = [...stems].sort((a, b) => a.start - b.start)
  const missing: Array<{ no: number; start: number; end: number }> = []
  for (let no = 1; no <= maxNo; no++) {
    if (known.has(no)) continue
    const s = byNo.get(no)
    if (!s) continue
    const next = ordered.find((x) => x.start > s.start)
    const end = next ? next.start : text.length
    const seg = text.slice(s.start, Math.min(end, s.start + 2500))
    if (seg.trim().length > 10) missing.push({ no, start: s.start, end })
  }
  return missing
}

// ---------- 文末集中答案键解析 ----------
// 支持 "1.C 2.A 3.D ..."（单选）与 "1.√ 2.√ 6.× ..."（判断）两种常见文末答案格式
export interface AnswerKeys {
  singles: Map<number, string>
  judges: Map<number, string>
}

function collectRuns(text: string, re: RegExp): Array<Array<[number, string]>> {
  const pairs: Array<[number, string]> = []
  for (const m of text.matchAll(re)) {
    pairs.push([parseInt(m[1], 10), m[2]])
  }
  const runs: Array<Array<[number, string]>> = []
  let cur: Array<[number, string]> = []
  for (const p of pairs) {
    if (cur.length === 0 || p[0] === cur[cur.length - 1][0] + 1) cur.push(p)
    else {
      if (cur.length >= 5) runs.push(cur)
      cur = [p]
    }
  }
  if (cur.length >= 5) runs.push(cur)
  return runs
}

export function parseAnswerKeys(text: string): AnswerKeys {
  const singles = new Map<number, string>()
  const judges = new Map<number, string>()
  for (const run of collectRuns(text, /(\d{1,3})\s*[.、,，．]\s*([A-H])(?![A-Za-z0-9])/g)) {
    for (const [no, v] of run) singles.set(no, v)
  }
  for (const run of collectRuns(text, /(\d{1,3})\s*[.、,，．]\s*(√|×|✓|✗|对|错|正确|错误)/g)) {
    for (const [no, v] of run) {
      const n = normalizeJudgeAnswer(v)
      if (n === '正确' || n === '错误') judges.set(no, n)
    }
  }
  return { singles, judges }
}

// 片段是否包含成规模的答案键（用于判断“空抽取”是否合法）
export function hasAnswerKeyRun(text: string): boolean {
  const k = parseAnswerKeys(text)
  return k.singles.size >= 5 || k.judges.size >= 5
}

// 将文末答案键回填到缺答案的题目。
// 策略：答案键完整覆盖该题型时优先按题干编号精确匹配（含覆盖 LLM 乱猜的答案）；
// 剩余题目按出现顺序用未占用的编号对齐。
export function applyAnswerKeys(qs: ParsedQuestion[], keys: AnswerKeys): number {
  let applied = 0
  const applyGroup = (type: 'single' | 'judge', key: Map<number, string>) => {
    const group = qs.filter((q) => q.type === type)
    if (group.length === 0 || key.size === 0) return
    if (key.size < Math.min(group.length, 5)) return
    const used = new Set<number>()
    // 1) 题干带编号且能对上：答案键权威，覆盖 LLM 的答案（其常见于猜测）
    const authoritative = key.size >= group.length
    for (const q of group) {
      const n = extractStemNumber(q.stem)
      if (n === null || !key.has(n) || used.has(n)) continue
      if (!authoritative && q.answer) continue // 键不完整时仅填空缺
      if (q.answer !== key.get(n)!) applied++
      q.answer = key.get(n)!
      used.add(n)
    }
    // 2) 剩余空缺按出现顺序用最小未用编号回填（LLM 自行编号/未编号时按序对齐）
    const remaining = group.filter((q) => !q.answer)
    const free = [...key.keys()].filter((n) => !used.has(n)).sort((a, b) => a - b)
    if (remaining.length > 0 && free.length >= remaining.length) {
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].answer = key.get(free[i])!
        applied++
      }
    }
  }
  applyGroup('single', keys.singles)
  applyGroup('judge', keys.judges)
  return applied
}
