// ============================================================
// 规则化题库解析器 —— 专为"老师给的不规范题库文档"设计
//
// 能力：
// 1. 清洗页眉页脚、水印、重复行、页码
// 2. 识别题型分区（一、单选题 / 二、多选题 …… 各种写法）
// 3. 识别各种不规范题号：1. / 1、 / 1． / (1) / 1) / 1: / 第1题 / 裸数字行
// 4. 识别行内/跨行/单行混排的选项：A. A、A．(A) A) A：A 空格
// 5. 识别答案标记：【答案】/ 正确答案：/ 参考答案 / 标准答案 / 答案: / 答：
//    以及题干末尾嵌入答案：（√）（×）（A）(ABD)
// 6. 识别解析：【解析】/ 答案解析 / 解析：
// 7. 文末答案汇总表匹配（1-5 ACBDA / 1.A 2.B …）
// 8. 对未分区文本自动推断题型
// ============================================================

import {
  ParsedQuestion,
  QuestionOption,
  QuestionType,
} from '../types'

// ---------------- 题型关键词 ----------------

const SECTION_KEYWORDS: { type: QuestionType; words: string[] }[] = [
  { type: 'SINGLE', words: ['单项选择题', '单项选择', '单选题', '单选'] },
  { type: 'MULTIPLE', words: ['多项选择题', '多项选择', '多选题', '多选'] },
  { type: 'TRUE_FALSE', words: ['判断题', '是非题', '判断正误', '判断对错'] },
  { type: 'FILL_BLANK', words: ['填空题', '填空'] },
  { type: 'TERM', words: ['名词解释'] },
  {
    type: 'SHORT_ANSWER',
    words: ['简答题', '简答', '问答题', '问答', '简述题'],
  },
  { type: 'ESSAY', words: ['论述题', '论述'] },
  { type: 'CALCULATION', words: ['计算题'] },
  {
    type: 'CASE',
    words: ['案例分析题', '案例分析', '案例题', '材料分析题', '分析说明题', '分析题'],
  },
]

// 长词优先，避免"单项选择题"被"单选"截胡后残留"项选择题"
const ALL_KEYWORDS = SECTION_KEYWORDS.flatMap((s) =>
  s.words.map((w) => ({ type: s.type, word: w })),
).sort((a, b) => b.word.length - a.word.length)

// ---------------- 文本规范化 ----------------

const PAGE_NOISE_PATTERNS: RegExp[] = [
  /^第\s*\d+\s*页(?:\s*[,，/共]\s*共?\s*\d+\s*页)?$/i,
  /^[\d\-–—]+\s*\/\s*[\d\-–—]+$/,
  /^[—\-=_·\s]{3,}$/,
  /^\s*共\s*\d+\s*页\s*$/,
]

/** 全角转半角（数字与字母），便于统一匹配 */
function normalizeFullWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
}

function isQuestionStartLike(t: string): boolean {
  return /^\s*(?:第\s*\d+\s*题|\d{1,3}\s*[\.、．)）:：]|\d{1,3}\s|[（(]\d{1,3}[)）])/.test(t)
}
function isOptionLineLike(t: string): boolean {
  return /^\s*(?:[（(][A-Ha-h][)）]|[A-Ha-h]\s*[\.、．:：)）])\s*\S/.test(t)
}

/** 清洗整篇文档文本 */
export function normalizeDocument(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n')
  text = normalizeFullWidth(text)
  text = text.replace(/\u3000/g, ' ')
  text = text.replace(/\u00A0/g, ' ').replace(/[\t\v\f]/g, ' ')
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '')

  const lines = text.split('\n')

  // 移除重复出现的页眉/页脚（同一行出现 >= 3 次且较短，且不是题目/选项/答案）
  const freq = new Map<string, number>()
  for (const l of lines) {
    const key = l.trim()
    if (key.length >= 4 && key.length <= 60) {
      freq.set(key, (freq.get(key) || 0) + 1)
    }
  }
  const repeated = new Set(
    [...freq.entries()]
      .filter(
        ([k, n]) =>
          n >= 3 && !isQuestionStartLike(k) && !isOptionLineLike(k),
      )
      .map(([k]) => k),
  )

  const cleaned = lines.filter((l) => {
    const t = l.trim()
    if (!t) return true
    if (PAGE_NOISE_PATTERNS.some((p) => p.test(t))) return false
    if (repeated.has(t)) return false
    return true
  })

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------- 题型分区识别 ----------------

interface Section {
  type: QuestionType | null
  startLine: number
  endLine: number // exclusive
  headerText: string
}

const SECTION_HEADER_PREFIX =
  /^(?:第\s*[一二三四五六七八九十\d]+\s*(?:部分|大题|题类|章|节)|[一二三四五六七八九十]{1,3}|\d{1,2}|[（(][一二三四五六七八九十\d]{1,3}[)）])\s*[、.．:：]?\s*/

function detectSections(lines: string[]): Section[] {
  const headers: { idx: number; type: QuestionType }[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t || t.length > 40) continue
    let rest = t
    if (SECTION_HEADER_PREFIX.test(rest)) {
      rest = rest.replace(SECTION_HEADER_PREFIX, '')
    } else if (/^题型/.test(rest)) {
      rest = rest.replace(/^题型\s*[:：]?\s*/, '')
    }
    // 去掉尾部的说明性括号（如（每题2分，共20分）（正确写√，错误写×））
    rest = rest
      .replace(/[（(][^（()）]*[)）]\s*$/, '')
      .replace(/[（(][^（()）]*[)）]\s*$/, '')
      .trim()
    rest = rest.replace(/\s*[:：]\s*$/, '').trim()
    if (!rest) continue
    if (rest.length > 12) continue

    for (const kw of ALL_KEYWORDS) {
      if (rest === kw.word || rest.startsWith(kw.word)) {
        // 必须是"几乎纯标题"的行，避免把题干当标题
        const tail = rest
          .slice(kw.word.length)
          .replace(/[（(]共?\d+题[)）]|[（(]\d+分[)）]/g, '')
          .trim()
        if (tail === '' || /^共?\d+题?$/.test(tail)) {
          headers.push({ idx: i, type: kw.type })
          break
        }
      }
    }
  }

  if (headers.length === 0) {
    return [
      { type: null, startLine: 0, endLine: lines.length, headerText: '' },
    ]
  }

  const sections: Section[] = []
  for (let h = 0; h < headers.length; h++) {
    const { idx, type } = headers[h]
    const end = h + 1 < headers.length ? headers[h + 1].idx : lines.length
    sections.push({
      type,
      startLine: idx + 1,
      endLine: end,
      headerText: lines[idx],
    })
  }
  // 第一个标题之前的前言部分
  if (headers[0].idx > 0) {
    sections.unshift({
      type: null,
      startLine: 0,
      endLine: headers[0].idx,
      headerText: '',
    })
  }
  return sections
}

// ---------------- 题目切分 ----------------

interface RawBlock {
  lines: string[]
  num: number | null
}

/**
 * 判断一行是否为"新题开始"，并返回题号
 * expected: 期望的下一个题号（null 表示尚未确定）
 */
function matchQuestionStart(
  line: string,
  nextLine: string | undefined,
  expected: number | null,
  isFirst: boolean,
): number | null {
  const t = line.trim()
  if (!t) return null

  let num: number | null = null
  let m: RegExpMatchArray | null

  if ((m = t.match(/^(?:第\s*(\d{1,3})\s*题)\s*[\.、．:：]?\s*/))) {
    num = parseInt(m[1])
  } else if ((m = t.match(/^(\d{1,3})\s*[\.、．,，:：]\s*(?!\d)/))) {
    // 题号 + 分隔符（排除小数 3.14）
    num = parseInt(m[1])
  } else if ((m = t.match(/^[（(](\d{1,3})[)）]\s*/))) {
    num = parseInt(m[1])
  } else if ((m = t.match(/^(\d{1,3})\s+(?=\S)/))) {
    // 裸数字 + 空格
    num = parseInt(m[1])
  } else if (/^\d{1,3}$/.test(t) && nextLine && nextLine.trim()) {
    // 裸数字行 + 下一行有内容
    num = parseInt(t)
  }

  if (num === null || num === 0) return null

  if (isFirst) return num >= 1 && num <= 300 ? num : null
  // 序列校验：正常递增 / 跳号(缺题) / 重复号(两题同号)
  if (expected !== null) {
    if (num === expected || (num > expected && num <= expected + 5))
      return num
    return null
  }
  return num
}

/** 判断切分后的剩余部分是否“像一道题” */
function looksLikeQuestion(s: string): boolean {
  const t = s.trim()
  if (t.length >= 10) return true
  if (/[（(]\s*[A-Ha-h]?\s*[)）]/.test(t)) return true
  if (/_{2,}|＿{2,}/.test(t)) return true
  if (/[？！?]$/.test(t)) return true
  return false
}

/**
 * 行内合并新题的切分点：期望题号 + 分隔符
 * 优先要求强标点在前；否则要求剩余部分“像一道题”
 */
function findInlineSplit(
  line: string,
  expected: number,
): { idx: number; len: number; num: number } | null {
  if (expected < 1 || expected > 300) return null
  const strong = new RegExp(
    `(?<=[。？！；;：:”\"!．.])\\s*${expected}\\s*[、．]\\s*(?=[^\\d\\s])`,
    'g',
  )
  let m = strong.exec(line)
  if (m) {
    return { idx: m.index, len: m[0].length, num: expected }
  }
  const loose = new RegExp(
    `(?<![0-9．.])\\s*${expected}\\s*[、．]\\s*(?=[^\\d\\s])`,
    'g',
  )
  m = loose.exec(line)
  if (m && looksLikeQuestion(line.slice(m.index + m[0].length))) {
    return { idx: m.index, len: m[0].length, num: expected }
  }
  return null
}

function stripQuestionPrefix(line: string): string {
  return line
    .trim()
    .replace(
      /^(?:第\s*\d{1,3}\s*题|\d{1,3}\s*[\.、．,，:：]|\d{1,3}\s+(?=\S)|[（(]\d{1,3}[)）])\s*/,
      '',
    )
}

function splitIntoBlocks(lines: string[]): RawBlock[] {
  const blocks: RawBlock[] = []
  let expected: number | null = null
  let current: RawBlock | null = null

  const pushCurrent = () => {
    if (current) {
      blocks.push(current)
      current = null
    }
  }

  /** 把一段文本接入当前块；若其中藏着下一题（行内合并）则递归切分 */
  const handleText = (text: string) => {
    if (expected !== null && current) {
      const split = findInlineSplit(text, expected + 1)
      if (split) {
        const head = text.slice(0, split.idx).trim()
        if (head) current.lines.push(head)
        pushCurrent()
        const rest = text.slice(split.idx + split.len)
        current = { lines: [], num: split.num }
        expected = split.num
        handleText(rest)
        return
      }
    }
    if (current) current.lines.push(text)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const num = matchQuestionStart(
      line,
      lines[i + 1],
      expected,
      current === null,
    )
    if (num !== null) {
      pushCurrent()
      current = { lines: [], num }
      expected = num
      handleText(stripQuestionPrefix(line))
      continue
    }
    handleText(line)
  }
  pushCurrent()
  return blocks
}

// ---------------- 答案 / 解析 ----------------

const ANSWER_MARKER =
  /(?:【答案】|【答\s*案】|(?:正确)?答案(?:是|为)(?=[A-Ha-h√×✓对错TF])|标准答案\s*[:：]?|参考答案\s*[:：]?|正确答案\s*[:：]?|最佳答案\s*[:：]?|(?:^|\n)\s*答\s*[:：]|答案\s*[:：])/
const EXPLANATION_MARKER =
  /(?:【解析】|【解\s*析】|【点\s*评】|答案解析\s*[:：]?|试题解析\s*[:：]?|解析\s*[:：]|解题思路\s*[:：]?)/

function splitAnswerExplanation(
  text: string,
): { stem: string; answer: string; explanation: string } {
  const ansIdx = text.search(ANSWER_MARKER)
  if (ansIdx < 0) {
    const expIdx = text.search(EXPLANATION_MARKER)
    if (expIdx >= 0) {
      const em = text.slice(expIdx).match(EXPLANATION_MARKER)
      return {
        stem: text.slice(0, expIdx),
        answer: '',
        explanation: cleanJoin(text.slice(expIdx + (em?.[0].length || 0))),
      }
    }
    return { stem: text, answer: '', explanation: '' }
  }

  const marker = text.slice(ansIdx).match(ANSWER_MARKER)?.[0] || ''
  const afterAnswer = text.slice(ansIdx + marker.length)
  const expMatch = afterAnswer.match(EXPLANATION_MARKER)
  let answer: string
  let explanation = ''
  if (expMatch && expMatch.index !== undefined) {
    answer = afterAnswer.slice(0, expMatch.index)
    explanation = cleanJoin(
      afterAnswer.slice(expMatch.index + expMatch[0].length),
    )
  } else {
    // 答案后若直接接下一题号，则截断
    const nextQ = afterAnswer.search(/\n\s*\d{1,3}\s*[\.、．,，:：]\s*\S/)
    answer = nextQ >= 0 ? afterAnswer.slice(0, nextQ) : afterAnswer
  }
  return {
    stem: text.slice(0, ansIdx),
    answer: answer.trim(),
    explanation,
  }
}

/** 智能拼接多行文本：中文行间不加空格，英文单词间补空格 */
function cleanJoin(s: string): string {
  const parts = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let out = ''
  for (const p of parts) {
    if (!out) {
      out = p
      continue
    }
    const prev = out[out.length - 1]
    if (/[A-Za-z0-9)>%$"']/.test(prev) && /^[A-Za-z0-9(<$(]/.test(p)) {
      out += ' ' + p
    } else {
      out += p
    }
  }
  return out.trim()
}

// ---------------- 选项识别 ----------------

interface OptionCandidate {
  labelIdx: number
  textStart: number
  label: string
  bracket: boolean
}

// 标签 + 分隔符：A. A、 A． A: A： （前面不能是英文字母/数字，避免 partA. 2A. 误判）
const OPT_RE_1 = /(?<![A-Za-z0-9])([A-Ha-h])\s*[\.、．:：]\s*(?=\S)/g
// 括号形式：（A） (A)
const OPT_RE_2 = /(?<![A-Za-z0-9])[（(]([A-Ha-h])[）)]\s*/g
// 裸大写字母 + 空格：A 目标（仅大写，避免英文小写单词误判）
const OPT_RE_3 = /(?<![A-Za-z0-9])([A-H])\s+(?=\S)/g

function scanOptionCandidates(joined: string): OptionCandidate[] {
  const candidates: OptionCandidate[] = []
  const seenAt = new Set<number>()

  const collect = (re: RegExp, bracket: boolean) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(joined)) !== null) {
      const label = (m[1] || '').toUpperCase()
      const labelIdx = m.index
      const textStart = m.index + m[0].length
      if (!seenAt.has(labelIdx)) {
        seenAt.add(labelIdx)
        candidates.push({ labelIdx, textStart, label, bracket })
      }
      if (candidates.length > 40) break
    }
  }

  collect(OPT_RE_1, false)
  collect(OPT_RE_2, true)
  collect(OPT_RE_3, false)
  candidates.sort((a, b) => a.labelIdx - b.labelIdx)

  // 形如 "（A）A.xxx"：括号里的是答案，后面才是选项 → 去掉括号候选
  const filtered = candidates.filter((c, i) => {
    if (!c.bracket) return true
    const next = candidates[i + 1]
    if (next && next.label === c.label && next.labelIdx - c.labelIdx <= 4) {
      return false
    }
    return true
  })

  // 形如 "题干（B）A.xxx B.yyy"：括号里是答案而非选项 → 跳过它从 A 开始
  if (
    filtered.length >= 2 &&
    filtered[0].bracket &&
    filtered[0].label !== 'A' &&
    filtered[1].label === 'A'
  ) {
    filtered.shift()
  }
  return filtered
}

/** 从题干文本中提取选项（行内优先，行级兜底） */
function extractOptions(stem: string): {
  stem: string
  options: QuestionOption[]
} {
  const joined = cleanJoin(stem)

  // ---- 行内识别 ----
  const candidates = scanOptionCandidates(joined)
  if (candidates.length >= 2 && candidates[0].label === 'A') {
    // 选取字母严格递增的连续序列
    const seq: OptionCandidate[] = [candidates[0]]
    for (let i = 1; i < candidates.length; i++) {
      const prev = seq[seq.length - 1]
      const cur = candidates[i]
      if (
        cur.label.charCodeAt(0) > prev.label.charCodeAt(0) &&
        cur.labelIdx > prev.textStart
      ) {
        seq.push(cur)
      }
    }
    const valid =
      seq.length >= 2 &&
      joined.slice(0, seq[0].labelIdx).trim().length >= 2 &&
      seq.every((c, k) => {
        const end = k + 1 < seq.length ? seq[k + 1].labelIdx : joined.length
        return joined.slice(c.textStart, end).trim().length > 0
      })
    if (valid) {
      const options: QuestionOption[] = seq.map((c, k) => {
        const end =
          k + 1 < seq.length ? seq[k + 1].labelIdx : joined.length
        return {
          label: c.label,
          text: joined.slice(c.textStart, end).trim(),
        }
      })
      return { stem: joined.slice(0, seq[0].labelIdx).trim(), options }
    }
  }

  // ---- 行级识别（每行一个选项）----
  const lines = stem
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const optLineIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*[（(][A-Ha-h][)）]\s*\S/.test(lines[i]) ||
      /^\s*[A-Ha-h]\s*[\.、．:：]\s*\S/.test(lines[i]) ||
      /^\s*[A-Ha-h]\s*[\.、．:：]?\s+\S/.test(lines[i])
    ) {
      optLineIdx.push(i)
    }
  }
  if (optLineIdx.length >= 2) {
    const first = optLineIdx[0]
    const stemLines = lines.slice(0, first)
    const options: QuestionOption[] = []
    for (let k = 0; k < optLineIdx.length; k++) {
      const start = optLineIdx[k]
      const end =
        k + 1 < optLineIdx.length ? optLineIdx[k + 1] : lines.length
      const merged = cleanJoin(lines.slice(start, end).join('\n'))
      const lm = merged.match(
        /^\s*(?:[（(]([A-Ha-h])[)）]|([A-Ha-h])\s*[\.、．:：]?)\s*/,
      )
      const label = (
        lm?.[1] ||
        lm?.[2] ||
        String.fromCharCode(65 + k)
      ).toUpperCase()
      const body = merged.replace(
        /^\s*(?:[（(][A-Ha-h][)）]|[A-Ha-h]\s*[\.、．:：]?)\s*/,
        '',
      )
      options.push({ label, text: body })
    }
    return { stem: cleanJoin(stemLines.join('\n')), options }
  }

  return { stem: joined, options: [] }
}

// ---------------- 答案归一化 ----------------

function normalizeAnswer(
  raw: string,
  type: QuestionType,
  optionLabels: string[],
): { answer: string; typeFix?: QuestionType } {
  const a = raw.trim().replace(/^[:：\s]+/, '').trim()
  if (!a) return { answer: '' }

  if (type === 'TRUE_FALSE') {
    return { answer: normalizeTf(a) }
  }

  if (type === 'SINGLE' || type === 'MULTIPLE') {
    const letters = Array.from(
      new Set((a.match(/[A-Ha-h]/g) || []).map((c) => c.toUpperCase())),
    )
      .filter(
        (c) => optionLabels.length === 0 || optionLabels.includes(c),
      )
      .sort()
    if (letters.length > 0) {
      if (letters.length > 1 && type === 'SINGLE') {
        return { answer: letters.join(''), typeFix: 'MULTIPLE' }
      }
      return { answer: letters.join('') }
    }
    return { answer: a }
  }

  // 主观题/填空：去掉尾部多余标点
  return { answer: a.replace(/\s+$/, '') }
}

function normalizeTf(a: string): string {
  const t = a.trim()
  if (!t) return ''
  if (/^(对|正确|√|✓|T|t|true|Y|y|yes|是|A)/i.test(t)) return '对'
  if (/^(错|错误|×|x|X|F|f|false|N|n|no|否|B)/i.test(t)) return '错'
  return t
}

// ---------------- 题干末尾嵌入答案提取 ----------------

const EMBED_TF = /[（(]\s*(√|✓|×|x|X|对|错|正确|错误|T|t|F|f)\s*[)）]\s*$/
const EMBED_LETTERS = /[（(]\s*([A-Ha-h]{1,4})\s*[)）]\s*$/

/** 题干末尾（√）/（A）等形式的答案提取 */
function extractEmbeddedAnswer(
  stem: string,
  type: QuestionType,
  hasAnswer: boolean,
): { stem: string; answer: string } {
  if (hasAnswer) return { stem, answer: '' }

  if (type === 'TRUE_FALSE') {
    const m = stem.match(EMBED_TF)
    if (m) {
      return {
        stem: stem.slice(0, m.index).trim(),
        answer: normalizeTf(m[1]),
      }
    }
  }
  if (type === 'SINGLE' || type === 'MULTIPLE') {
    const m = stem.match(EMBED_LETTERS)
    if (m && m[1]) {
      return {
        stem: stem.slice(0, m.index).trim(),
        answer: m[1].toUpperCase(),
      }
    }
  }
  return { stem, answer: '' }
}

// ---------------- 题型推断 ----------------

function inferType(
  stem: string,
  options: QuestionOption[],
  answer: string,
): { type: QuestionType; uncertain: boolean } {
  if (options.length >= 2) {
    const letters = (answer.match(/[A-Ha-h]/g) || []).length
    if (letters > 1) return { type: 'MULTIPLE', uncertain: false }
    return { type: 'SINGLE', uncertain: false }
  }
  if (/_{2,}|＿{2,}|（\s*）|\(\s*\)|\[\s*\]/.test(stem)) {
    return { type: 'FILL_BLANK', uncertain: false }
  }
  const head = stem.slice(0, 12)
  if (/^(判断|辨析)[：:、.]/.test(head))
    return { type: 'TRUE_FALSE', uncertain: false }
  if (/名词解释|试解释/.test(stem)) return { type: 'TERM', uncertain: false }
  if (/论述|试述|谈谈你的看法|评析/.test(stem))
    return { type: 'ESSAY', uncertain: false }
  if (/计算|求解|求证|试算/.test(stem))
    return { type: 'CALCULATION', uncertain: false }
  if (/案例|结合材料|根据材料/.test(stem))
    return { type: 'CASE', uncertain: false }
  if (
    /^(简述|简答|试简述|什么是|为什么|试分析|分析|如何理解|举例说明|说明|阐述)/.test(
      head,
    ) ||
    stem.includes('？') ||
    stem.includes('?')
  ) {
    return { type: 'SHORT_ANSWER', uncertain: false }
  }
  return { type: 'SHORT_ANSWER', uncertain: true }
}

// ---------------- 文末答案表 ----------------

/** 纯答案字符行（如 1.A 2.B / 1-5 ACBDA / 1.√ 2.×），允许中文数字组号前缀 */
const isKeyLikeLine = (t: string): boolean =>
  t.length <= 80 &&
  /\d/.test(t) &&
  /[A-D√×✓对错TF]/.test(t) &&
  /^[\d\s\-–—~至A-Da-d√×✓对错TFxX\.、．,，:：()（）一二三四五六七八九十]+$/.test(t)

/** 判断一行是否为题型分区标题（如 二、填空题 / 三、判断题（每题1分）） */
function isSectionHeaderLike(t: string): boolean {
  if (!t || t.length > 40) return false
  let rest = t
  if (SECTION_HEADER_PREFIX.test(rest)) {
    rest = rest.replace(SECTION_HEADER_PREFIX, '')
  } else if (/^题型/.test(rest)) {
    rest = rest.replace(/^题型\s*[:：]?\s*/, '')
  }
  rest = rest
    .replace(/[（(][^（()）]*[)）]\s*$/, '')
    .replace(/[（(][^（()）]*[)）]\s*$/, '')
    .trim()
  rest = rest.replace(/\s*[:：]\s*$/, '').trim()
  if (!rest || rest.length > 12) return false
  return ALL_KEYWORDS.some((kw) => rest.startsWith(kw.word))
}

/** 答案区中一旦遇到即停止的"确定是题目"行（题号开头且具备题目特征） */
function isDefiniteQuestionLine(t: string): boolean {
  if (!isQuestionStartLike(t)) return false
  return (
    t.length > 30 ||
    /（\s*）|\(\s*\)|_{2,}|＿{2,}/.test(t) ||
    /\bA\s*[\.、．]/.test(t)
  )
}

/**
 * 把文档中的"参考答案/答案"汇总区从正文剥离。
 *
 * 关键修复：不再"标题行一刀切到文末"，而是——
 * 1. 标题行后的内容必须像答案（key-like / 题号开头的短答案行）才确认是答案区；
 * 2. 答案区在遇到下一个题型分区标题或明确的题目行时结束；
 * 3. 答案区从正文中"挖除"，其后的分区与题目完整保留在正文里。
 * 这样"每部分题目后跟参考答案"的文档不会把后续判断题/填空题/简答题吞掉。
 */
function splitAnswerKeySection(text: string): { main: string; key: string } {
  const lines = text.split('\n')

  const TITLE_RE =
    /^(?:参考答案|答案(?:汇总|表|速查|区|册)?|试题答案|标准答案|选择题答案|客观题答案)\s*[:：]?$/

  const keep = new Array<boolean>(lines.length).fill(true)
  const keyParts: string[] = []
  const startFrom = Math.max(0, Math.floor(lines.length * 0.25))

  for (let i = startFrom; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t || !keep[i] || !TITLE_RE.test(t)) continue

    // 收集该标题下的答案行：直到遇到分区标题 / 明确题目行为止
    const collected: number[] = []
    let keyCount = 0
    let j = i + 1
    for (; j < lines.length; j++) {
      const lt = lines[j].trim()
      if (!lt) continue
      if (isSectionHeaderLike(lt) || isDefiniteQuestionLine(lt)) break
      collected.push(j)
      if (isKeyLikeLine(lt) || isQuestionStartLike(lt)) keyCount++
    }

    if (collected.length >= 1 && keyCount >= 1) {
      keep[i] = false
      for (const k of collected) keep[k] = false
      keyParts.push(collected.map((k) => lines[k]).join('\n'))
      i = j - 1 // 继续寻找下一个答案区
    }
  }

  let main = lines.filter((_, idx) => keep[idx]).join('\n')
  let key = keyParts.join('\n')

  // 隐式答案表：挖除后的正文末尾连续 "1.A 2.B" 风格行
  const implicitLines = main.split('\n')
  const tailKey: string[] = []
  for (let i = implicitLines.length - 1; i >= 0; i--) {
    const t = implicitLines[i].trim()
    if (!t) continue
    if (isKeyLikeLine(t)) tailKey.unshift(implicitLines[i])
    else break
  }
  if (tailKey.length >= 2) {
    const cut = implicitLines.length - tailKey.length
    main = implicitLines.slice(0, cut).join('\n')
    key = key ? `${key}\n${tailKey.join('\n')}` : tailKey.join('\n')
  }

  return { main, key }
}

function parseAnswerKey(keyText: string): Map<number, string[]> {
  const keyMap = new Map<number, string[]>()
  if (!keyText.trim()) return keyMap

  // 区间形式：1-5 ACBDA / 6~10 ×√××√
  const rangeRe =
    /(\d{1,3})\s*[-–—~～至]\s*(\d{1,3})\s*[:：]?\s*([A-Da-d√×✓对错TFtfXx]{2,})/g
  let rm: RegExpExecArray | null
  while ((rm = rangeRe.exec(keyText)) !== null) {
    const start = parseInt(rm[1])
    const end = parseInt(rm[2])
    const answers = Array.from(rm[3])
    if (
      end > start &&
      end - start + 1 === answers.length &&
      end - start < 100
    ) {
      for (let n = start; n <= end; n++) {
        pushKey(keyMap, n, answers[n - start])
      }
    }
  }

  // 离散形式：1.A 2、B 3：对 4 √ 5 C（先移除区间部分，避免重复/误匹配）
  const rest = keyText.replace(rangeRe, '')
  const discRe =
    /(\d{1,3})\s*[\.、．:：)]?\s*([A-Da-d]{1,4}(?![\w])|√|✓|×|[XxFfTt]|[对错])/g
  let dm: RegExpExecArray | null
  while ((dm = discRe.exec(rest)) !== null) {
    pushKey(keyMap, parseInt(dm[1]), dm[2])
  }

  return keyMap
}

function pushKey(map: Map<number, string[]>, num: number, ans: string) {
  const arr = map.get(num) || []
  arr.push(ans.trim())
  map.set(num, arr)
}

// ---------------- 单题解析 ----------------

function parseBlock(
  block: RawBlock,
  sectionType: QuestionType | null,
): ParsedQuestion | null {
  const blockText = block.lines.join('\n')
  const { stem: stemPart, answer: answerPart, explanation } =
    splitAnswerExplanation(blockText)

  const { stem: stemClean0, options } = extractOptions(stemPart)
  let stemClean = stemClean0

  if (!stemClean.trim() && options.length === 0) {
    return null
  }

  let type: QuestionType = sectionType || 'OTHER'
  const warnings: string[] = []

  if (!sectionType) {
    const inferred = inferType(stemClean, options, answerPart)
    type = inferred.type
    if (inferred.uncertain) warnings.push('题型由内容推断，请核对')
  }

  if (type === 'TRUE_FALSE' && options.length > 0) {
    // 判断题不展示选项，由界面提供 对/错
    stemClean = stemClean // 选项内容可能是题干的一部分，不回填
    options.length = 0
  }

  // 题干末尾嵌入答案（（√）/（A））
  const embedded = extractEmbeddedAnswer(stemClean, type, !!answerPart)
  if (embedded.answer) {
    stemClean = embedded.stem
  }
  let answer = answerPart || embedded.answer

  // 分区为选择类但选项识别失败：保留题型，仅警告
  if ((type === 'SINGLE' || type === 'MULTIPLE') && options.length < 2) {
    warnings.push('选项识别不完整，请核对补充')
  }

  if (answer) {
    const norm = normalizeAnswer(
      answer,
      type,
      options.map((o) => o.label),
    )
    answer = norm.answer
    if (norm.typeFix) type = norm.typeFix

    // 填空/简答但答案是单个字母且无选项 → 实际是单选
    if (
      options.length === 0 &&
      (type === 'FILL_BLANK' || type === 'SHORT_ANSWER') &&
      /^[A-H]$/.test(answer)
    ) {
      type = 'SINGLE'
      warnings.push('答案为字母，题型推断为单选题，请核对')
    }
  } else {
    warnings.push('未识别到答案，可稍后补充')
  }

  if (answer && (type === 'SINGLE' || type === 'MULTIPLE')) {
    const letters = answer.split('')
    const valid =
      options.length === 0 ||
      letters.every((l) => options.some((o) => o.label === l))
    if (!valid) warnings.push('答案字母与选项不匹配，请核对')
  }

  if (!stemClean.trim()) return null

  return {
    type,
    stem: stemClean,
    options,
    answer,
    explanation: explanation || undefined,
    number: block.num ?? undefined,
    warnings: warnings.length ? warnings : undefined,
    raw: blockText.length > 500 ? blockText.slice(0, 500) + '…' : blockText,
  }
}

// ---------------- 主解析流程 ----------------

export interface RuleParseResult {
  questions: ParsedQuestion[]
  notices: string[]
}

export function parseQuestions(rawText: string): RuleParseResult {
  const normalized = normalizeDocument(rawText)
  const { main, key } = splitAnswerKeySection(normalized)
  const lines = main.split('\n')
  const sections = detectSections(lines)
  const notices: string[] = []

  const questions: ParsedQuestion[] = []

  for (const section of sections) {
    const segLines = lines.slice(section.startLine, section.endLine)
    const blocks = splitIntoBlocks(segLines)

    for (const block of blocks) {
      const q = parseBlock(block, section.type)
      if (q) questions.push(q)
    }
  }

  // ---------- 文末答案表匹配 ----------
  const keyMap = parseAnswerKey(key)
  if (keyMap.size > 0) {
    for (const q of questions) {
      if (q.answer || q.number === undefined) continue
      const num = q.number
      if (!keyMap.has(num)) continue
      const queue = keyMap.get(num)!
      if (queue.length === 0) continue
      const ans = queue.shift()!
      const norm = normalizeAnswer(ans, q.type, q.options.map((o) => o.label))
      if (norm.answer) {
        q.answer = norm.answer
        if (q.warnings) {
          q.warnings = q.warnings.filter((w) => w !== '未识别到答案，可稍后补充')
          if (q.warnings.length === 0) delete q.warnings
        }
      }
    }
  }

  // ---------- 重复题检测 ----------
  const seen = new Map<string, number>()
  questions.forEach((q, i) => {
    const key2 = q.stem.replace(/\s/g, '').slice(0, 60)
    if (seen.has(key2)) {
      q.warnings = [...(q.warnings || []), `与第 ${seen.get(key2)! + 1} 题重复`]
    } else {
      seen.set(key2, i)
    }
  })

  if (questions.length === 0) {
    notices.push(
      '未能按规则识别出题目。该文档格式可能过于混乱，建议尝试"AI 智能识别"',
    )
  }

  return { questions, notices }
}
