import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { ParsedQuestion, QuestionType } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const VALID_TYPES: QuestionType[] = [
  'SINGLE',
  'MULTIPLE',
  'TRUE_FALSE',
  'FILL_BLANK',
  'TERM',
  'SHORT_ANSWER',
  'ESSAY',
  'CALCULATION',
  'CASE',
  'OTHER',
]

/** 单块文本上限（超过应在前端分块后逐块调用，避免单请求超时 502） */
export const MAX_CHUNK_CHARS = 3200

const SYSTEM_PROMPT = `你是题库整理专家。用户会给定一段从 Word/PDF 中提取的考试题库文本，格式非常混乱（题号不规范、选项混排、答案位置不定）。请识别出所有题目，只输出一个 JSON 数组，不要输出任何其他文字、注释或 markdown 代码块标记。

每个元素格式：
{"type":"SINGLE","stem":"题干","options":[{"label":"A","text":"选项内容"}],"answer":"答案","explanation":"解析"}

字段说明：
- type 取值：SINGLE(单选) MULTIPLE(多选) TRUE_FALSE(判断) FILL_BLANK(填空) TERM(名词解释) SHORT_ANSWER(简答) ESSAY(论述) CALCULATION(计算) CASE(案例分析) OTHER(其他)
- stem：题干文本。若是填空题，用 ____ 表示空位；去掉题号；去掉（√）（A）之类嵌在末尾的答案标记
- options：仅选择题/判断题需要；判断题留空数组 []；其他题型留空数组 []
- answer：单选/多选为大写字母（如 "A" 或 "ABD"）；判断题只写 "对" 或 "错"（√、正确、T 统一为"对"；×、错误、F 统一为"错"）；填空/简答等写文字答案
- explanation：有解析就写，没有就写空字符串 ""
- 未找到答案时 answer 写 ""
- 忽略页眉页脚、页码、水印、广告、与题目无关的说明文字
- 答案可能出现在题干括号里、题目末尾、或文末答案表（如 "1-5 ACBDA"），请对应匹配
- 保持题目数量完整，宁多勿漏`

const USER_TEMPLATE = (text: string) => `以下是题库文本片段，请识别所有题目并输出 JSON 数组：

<<<文本开始
${text}
文本结束>>>`

/** 从模型输出中提取 JSON 数组 */
function extractJsonArray(raw: string): unknown[] {
  let s = raw.trim()
  // 去掉 markdown 代码块
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start >= 0 && end > start) {
    s = s.slice(start, end + 1)
  }
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function sanitizeQuestions(arr: unknown[]): ParsedQuestion[] {
  const out: ParsedQuestion[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const stem = typeof q.stem === 'string' ? q.stem.trim() : ''
    if (!stem) continue
    const type = VALID_TYPES.includes(q.type as QuestionType)
      ? (q.type as QuestionType)
      : 'OTHER'
    const options = Array.isArray(q.options)
      ? (q.options as unknown[])
          .map((o) => {
            const ob = (o || {}) as Record<string, unknown>
            return {
              label: String(ob.label || '').trim().toUpperCase().slice(0, 1),
              text: String(ob.text || '').trim(),
            }
          })
          .filter((o) => o.text)
      : []
    const answer = String(q.answer ?? '').trim()
    const explanation =
      typeof q.explanation === 'string' && q.explanation.trim()
        ? q.explanation.trim()
        : undefined
    out.push({ type, stem, options, answer, explanation })
  }
  return out
}

/**
 * POST /api/parse-ai
 * body: { text: string }   —— 单块文本（≤ 3200 字符）
 * 使用 LLM 对混乱文本进行智能题目识别（单次调用，快速返回，避免网关超时 502）。
 * 长文本请在前端分块后循环调用，再自行合并去重。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: '缺少文本内容' }, { status: 400 })
    }
    if (text.length > MAX_CHUNK_CHARS) {
      return NextResponse.json(
        { error: `单次 AI 识别文本过长（${text.length} 字符），请分块调用` },
        { status: 400 },
      )
    }

    const zai = await ZAI.create()
    let questions: ParsedQuestion[] = []
    let lastError: unknown = null

    // 单块重试 2 次
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: SYSTEM_PROMPT },
            { role: 'user', content: USER_TEMPLATE(text) },
          ],
          thinking: { type: 'disabled' },
        })
        const raw = completion.choices[0]?.message?.content || ''
        questions = sanitizeQuestions(extractJsonArray(raw))
        if (questions.length > 0) break
        lastError = new Error('模型未返回有效题目')
      } catch (e) {
        lastError = e
      }
    }

    if (questions.length === 0) {
      return NextResponse.json(
        {
          error:
            lastError instanceof Error
              ? `AI 未能识别出题目：${lastError.message}`
              : 'AI 未能识别出题目，请检查文本内容',
          questions: [],
        },
        { status: 422 },
      )
    }

    return NextResponse.json({ questions, notices: [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 识别失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
