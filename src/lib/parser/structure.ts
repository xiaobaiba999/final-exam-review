/**
 * 文档结构分析 —— AI 流式识别的前置 Agent 步骤（纯规则，不调用 LLM）
 *
 * 1) 归一化文本（Word 自动编号丢失、全角空格、页码等）
 * 2) 分离「题目区」与「参考答案区」
 * 3) 按大题标题（一、二、三…）切分章节，并推断题型
 * 4) 每个章节按题目边界切成适合 LLM 的小块
 * 5) 确定性解析答案表（选择题 1.C 2.A / 判断题 1.√ / 填空·主观题按顺序）
 */

export interface AnswerEntry {
  /** 题号（按顺序时 = 序号） */
  num: number
  text: string
}

export interface AnswerKey {
  /** 选择题：题号 -> 字母（如 1 -> "C"） */
  choice: Map<number, string>
  /** 判断题：题号 -> 对/错 */
  tf: Map<number, string>
  /** 填空题答案（按题号/顺序） */
  fill: AnswerEntry[]
  /** 主观题答案（简答/名词解释/算法设计等，按顺序） */
  subjective: AnswerEntry[]
}

export interface DocSection {
  index: number
  /** 章节标题，如「一、单项选择题（共 45 题）」 */
  title: string
  /** 题型提示（QuestionType 或 '' 表示未知） */
  typeHint: string
  /** 章节题目原文 */
  text: string
  /** 切分后的 LLM 输入块 */
  chunks: string[]
}

export interface DocStructure {
  text: string
  sections: DocSection[]
  answerKey: AnswerKey | null
  hasAnswerKey: boolean
  chars: number
}

// ============================================================
// 文本归一化
// ============================================================

/** 归一化：换行统一、压缩空白、去页码装饰行 */
export function normalizeDocText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter((l) => {
      if (!l) return true
      // 纯符号装饰行 / 独立页码行 / 页脚
      if (/^[-=*_·.~—\s]*$/.test(l)) return false
      if (/^\d{1,4}$/.test(l)) return false
      if (/^第\s*\d+\s*页(.*共\s*\d+\s*页)?$/.test(l)) return false
      return true
    })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ============================================================
// 章节与答案区识别
// ============================================================

/** 大题标题：一、 / 二. / （三）等行首 */
const SECTION_HEAD_RE = /^[一二三四五六七八九十]{1,3}\s*[、.．，,：:]\s*\S/

/** 答案区标题行：参考答案 / 【答案】 / 一、参考答案及解析 …
 *  关键：「答案：C」「答案：1.A 2.B」这类冒号后带内容的行是逐题/分组答案行（学习通导出常见），
 *  不是答案区标题——若误判会把第一题之后的所有题目整体丢进答案区（表现为"识别少太多"）。 */
function isAnswerHeading(line: string): boolean {
  const raw = line.trim()
  if (!raw || raw.length > 30) return false
  // 冒号（中英文）后还有实质内容 → 是答案内容行，不是标题
  const colon = raw.search(/[：:]/)
  if (colon >= 0) {
    const after = raw
      .slice(colon + 1)
      .replace(/^[）)】\]」』\s]+/, '')
      .trim()
    if (after) return false
  }
  const t = raw.replace(/[^一-鿿]/g, '')
  if (!t || t.length > 10) return false
  return /^[一二三四五六七八九十]?(参考)?(答案|参考答案)(及|与|和)?(解析|评分标准|点评|汇总|详解|简析)?$/.test(t)
}

/** 从章节标题推断题型提示 */
export function typeHintFromTitle(title: string): string {
  if (/多项选择|多选题|多选/.test(title)) return 'MULTIPLE'
  if (/单项选择|单选题|单选|选择/.test(title)) return 'SINGLE'
  if (/判断/.test(title)) return 'TRUE_FALSE'
  if (/填空|完形填空/.test(title)) return 'FILL_BLANK'
  if (/名词解释/.test(title)) return 'TERM'
  if (/论述|材料题/.test(title)) return 'ESSAY'
  if (/简答|问答|简述/.test(title)) return 'SHORT_ANSWER'
  if (/算法设计|编程|程序设计|代码/.test(title)) return 'SHORT_ANSWER'
  if (/计算/.test(title)) return 'CALCULATION'
  if (/案例|材料分析/.test(title)) return 'CASE'
  return ''
}

// ============================================================
// 章节内切块（按题目边界，控制单块长度避免 LLM 超时）
// ============================================================

const CHUNK_TARGET = 1500
const CHUNK_MAX = 2200

function isQuestionBoundary(line: string): boolean {
  return /^\s*(\d{1,3}\s*[.、．)）]|[（(]\s*\d{1,3}\s*[)）]|题目\s*\d{1,3})/.test(line)
}

export function chunkSectionText(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= CHUNK_MAX) return [t]

  const chunks: string[] = []
  let buf = ''
  for (const line of t.split('\n')) {
    if (buf && buf.length + line.length > CHUNK_TARGET && (isQuestionBoundary(line) || buf.length > CHUNK_MAX)) {
      chunks.push(buf.trim())
      buf = line
    } else {
      buf += (buf ? '\n' : '') + line
    }
  }
  if (buf.trim()) chunks.push(buf.trim())

  // 兜底：超长块硬切
  const out: string[] = []
  for (const c of chunks) {
    if (c.length <= CHUNK_MAX) {
      out.push(c)
    } else {
      for (let i = 0; i < c.length; i += CHUNK_TARGET) {
        out.push(c.slice(i, i + CHUNK_TARGET))
      }
    }
  }
  return out
}

// ============================================================
// 答案表解析（确定性，不依赖 AI）
// ============================================================

/** 答案区小节标记：（一）选择题答案 / 1.选择题 / 【选择题答案】 */
const ANSWER_SUB_RE = /^[（(]\s*[一二三四五六七八九十\d]{1,3}\s*[)）]\s*(.{0,24})$/

function splitAnswerBlocks(raw: string): { label: string; text: string }[] {
  const blocks: { label: string; text: string }[] = []
  let curLabel = ''
  let curText: string[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(ANSWER_SUB_RE)
    if (m && /[选择判断填空简答论述名词计算案例算法客观主观题答案问答]/.test(m[1] || '')) {
      if (curText.some((l) => l.trim())) blocks.push({ label: curLabel, text: curText.join('\n') })
      curLabel = m[1] || ''
      curText = []
    } else {
      curText.push(line)
    }
  }
  if (curText.some((l) => l.trim())) blocks.push({ label: curLabel, text: curText.join('\n') })
  return blocks
}

function classifyBlock(label: string): 'choice' | 'tf' | 'fill' | 'subjective' | 'unknown' {
  if (/多?选/.test(label)) return 'choice'
  if (/判断/.test(label)) return 'tf'
  if (/填空|完形/.test(label)) return 'fill'
  if (/简答|论述|名词|计算|案例|算法|问答|分析|作文|翻译|主观/.test(label)) return 'subjective'
  return 'unknown'
}

/** 密集选择题答案：1.C 2.A 3.D …（要求题号后有分隔符，避免误配正文） */
function parseDenseLetterMap(text: string, strict: boolean): Map<number, string> {
  const map = new Map<number, string>()
  const sep = strict ? '[.、．:：)]' : '[.、．:：)]?'
  const re = new RegExp(`(\\d{1,3})\\s*${sep}\\s*([A-H])(?![A-Za-z0-9])`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 500 && !map.has(n)) map.set(n, m[2])
  }
  return map
}

/** 密集判断题答案：1.√ 2.× 3.对 … */
function parseDenseTfMap(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const re = /(\d{1,3})\s*[.、．:：)]\s*([√×✓✗对错TFtf])(?![0-9a-zA-Z])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10)
    if (n < 1 || n > 500 || map.has(n)) continue
    const ch = m[2].toUpperCase()
    if ('√✓T'.includes(ch)) map.set(n, '对')
    else if ('×✗F'.includes(ch)) map.set(n, '错')
    else map.set(n, ch === '对' ? '对' : '错')
  }
  return map
}

function stripLeadingNumber(line: string): { num: number | null; text: string } {
  const m = line.match(/^(\d{1,3})\s*[.、．:：)]\s*(.+)$/)
  if (m) return { num: parseInt(m[1], 10), text: m[2].trim() }
  return { num: null, text: line }
}

/** 填空题答案：一行一个答案（可能有或没有编号），按顺序对应 */
function parseOrderedAnswers(text: string): AnswerEntry[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const entries: AnswerEntry[] = []
  let seq = 0
  for (const line of lines) {
    seq++
    const { num, text: t } = stripLeadingNumber(line)
    if (!t) continue
    entries.push({ num: num ?? seq, text: t.slice(0, 300) })
  }
  return entries
}

/** 主观题答案：按空行分段，一段一个答案 */
function parseSubjectiveAnswers(text: string): AnswerEntry[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter((p) => p && !/^[\d\s.、()（）]*$/.test(p))
  return paras.map((p, i) => {
    const { num, text: t } = stripLeadingNumber(p)
    return { num: num ?? i + 1, text: t.slice(0, 1200) }
  })
}

export function parseAnswerKey(raw: string): AnswerKey {
  const key: AnswerKey = { choice: new Map(), tf: new Map(), fill: [], subjective: [] }
  const blocks = splitAnswerBlocks(raw)
  for (const b of blocks) {
    const kind = classifyBlock(b.label)
    if (kind === 'choice') {
      const m = parseDenseLetterMap(b.text, true)
      const src = m.size >= 3 ? m : parseDenseLetterMap(b.text, false)
      for (const [n, a] of src) if (!key.choice.has(n)) key.choice.set(n, a)
    } else if (kind === 'tf') {
      for (const [n, a] of parseDenseTfMap(b.text)) if (!key.tf.has(n)) key.tf.set(n, a)
    } else if (kind === 'fill') {
      key.fill.push(...parseOrderedAnswers(b.text))
    } else if (kind === 'subjective') {
      key.subjective.push(...parseSubjectiveAnswers(b.text))
    } else {
      // 未标记小节：先尝试密集答案表，再当作主观段落
      const cm = parseDenseLetterMap(b.text, true)
      if (cm.size >= 3) {
        for (const [n, a] of cm) if (!key.choice.has(n)) key.choice.set(n, a)
        continue
      }
      const tm = parseDenseTfMap(b.text)
      if (tm.size >= 3) {
        for (const [n, a] of tm) if (!key.tf.has(n)) key.tf.set(n, a)
        continue
      }
      const sub = parseSubjectiveAnswers(b.text)
      if (sub.length) key.subjective.push(...sub)
    }
  }
  return key
}

/** 为指定题型章节生成「参考答案提示」文本（拼进 LLM prompt） */
export function buildAnswerHint(key: AnswerKey | null, typeHint: string): string {
  if (!key) return ''
  const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
  const sorted = (m: Map<number, string>) =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([n, a]) => `${n}.${a}`).join(' ')

  const parts: string[] = []
  if (typeHint === 'SINGLE' || typeHint === 'MULTIPLE') {
    if (key.choice.size) return `客观题答案表（题号.答案）：${sorted(key.choice)}`
  } else if (typeHint === 'TRUE_FALSE') {
    if (key.tf.size) return `判断题答案表（题号.对/错）：${sorted(key.tf)}`
  } else if (typeHint === 'FILL_BLANK') {
    if (key.fill.length) {
      return `填空题参考答案（编号=第几题；一题多空时答案用 ||| 分隔）：\n${key.fill
        .map((a) => `${a.num}. ${cap(a.text, 200)}`)
        .join('\n')}`
    }
  } else if (typeHint && key.subjective.length) {
    const entries = key.subjective
      .slice(0, 30)
      .map((a) => `${a.num}. ${cap(a.text, 500)}`)
      .join('\n')
    return (
      `主观题参考答案（编号与题目编号尽量对应，若不对应请按内容相关性匹配）：\n${entries}`
    )
  }

  // 题型未知或目标答案缺失：给出全部（精简）
  if (key.choice.size) parts.push(`选择题答案表：${sorted(key.choice)}`)
  if (key.tf.size) parts.push(`判断题答案表：${sorted(key.tf)}`)
  if (key.fill.length) parts.push(`填空题答案（按顺序）：${key.fill.map((a) => a.text).join(' | ')}`)
  if (key.subjective.length) {
    parts.push(
      `主观题答案（按顺序，按内容相关性匹配）：\n${key.subjective
        .slice(0, 20)
        .map((a) => `${a.num}. ${cap(a.text, 250)}`)
        .join('\n')}`,
    )
  }
  return parts.join('\n').slice(0, 3200)
}

// ============================================================
// 主入口：分析整个文档
// ============================================================

export function analyzeDocStructure(rawText: string): DocStructure {
  const text = normalizeDocText(rawText)
  const lines = text.split('\n')
  const chars = text.replace(/\s/g, '').length

  // 1) 找答案区起点
  let answerStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (isAnswerHeading(lines[i])) {
      answerStart = i
      break
    }
  }
  const questionLines = answerStart >= 0 ? lines.slice(0, answerStart) : lines
  const answerText = answerStart >= 0 ? lines.slice(answerStart + 1).join('\n') : ''
  const hasAnswerKey = answerStart >= 0 && answerText.replace(/\s/g, '').length > 3
  const answerKey = hasAnswerKey ? parseAnswerKey(answerText) : null

  // 2) 按大题标题切分章节
  const sections: DocSection[] = []
  let curTitle = ''
  let curType = ''
  let curLines: string[] = []

  const flush = () => {
    const body = curLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!body) return
    sections.push({
      index: sections.length,
      title: curTitle || '题目',
      typeHint: curType,
      text: body,
      chunks: [],
    })
  }

  for (const line of questionLines) {
    if (SECTION_HEAD_RE.test(line)) {
      flush()
      curTitle = line.trim().slice(0, 60)
      curType = typeHintFromTitle(line)
      curLines = []
    } else {
      curLines.push(line)
    }
  }
  flush()

  // 无任何大题标题：整体作为一个章节
  if (sections.length === 0) {
    const body = questionLines.join('\n').trim()
    if (body) {
      sections.push({ index: 0, title: '题目', typeHint: '', text: body, chunks: [] })
    }
  }

  for (const s of sections) s.chunks = chunkSectionText(s.text)

  return { text, sections, answerKey, hasAnswerKey, chars }
}
