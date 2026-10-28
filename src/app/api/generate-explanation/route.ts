import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { QUESTION_TYPE_LABEL, type QuestionRecord, type QuestionType } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

/** 批量模式单次最多生成条数（避免请求超时，前端可循环调用直到 remaining=0） */
const BATCH_LIMIT = 8
const MAX_RETRIES = 2

const TYPE_HINTS: Record<QuestionType, string> = {
  SINGLE: '这是一道单选题。请说明正确选项为什么正确、本题考查的核心知识点，并逐个简要说明主要干扰项为什么错误。',
  MULTIPLE: '这是一道多选题。请分别说明每个正确选项入选的理由，以及容易漏选/错选的干扰项错在哪里。',
  TRUE_FALSE: '这是一道判断题。请给出判断依据，并说明容易混淆的错误说法应该如何纠正。',
  FILL_BLANK: '这是一道填空题。请给出标准答案并解释该知识点的含义，适当延伸相关考点。',
  TERM: '这是一道名词解释题。请给出规范的名词定义，并补充该概念的关键要素与举例说明。',
  SHORT_ANSWER: '这是一道简答题。请梳理标准答案的要点框架（分条列出），并说明每点的核心含义。',
  ESSAY: '这是一道论述题。请给出论述思路与要点框架，说明如何展开论证、需要引用哪些关键概念。',
  CALCULATION: '这是一道计算题。请给出解题思路与关键步骤（公式、单位、易错点），帮助理解从条件到结果的推导过程。',
  CASE: '这是一道案例分析题。请说明分析框架：如何从材料提取信息、对应哪些理论知识点、答案的组织逻辑。',
  OTHER: '请解析这道题的答案与涉及的知识点。',
}

const SYSTEM_PROMPT = `你是一位经验丰富的大学课程辅导老师，正在为学生编写考前复习用的题目解析。

要求：
1. 用中文输出，直接给出解析正文，不要任何开场白（如"好的"）、不要标题、不要 Markdown 符号（如 #、*、-）
2. 解析应包含：本题考点、答案依据、易错提示或记忆技巧（结合题目实际内容，不要套话）
3. 长度控制在 120～280 字，语言精炼、条理清晰，可直接分句分行表述
4. 以学生的视角解释"为什么"，而不是简单复述答案
5. 如果题目或答案信息不完整，基于题目内容做出最合理的解释，不要编造无关内容`

function buildUserPrompt(q: QuestionRecord): string {
  const lines: string[] = []
  lines.push(`【题型】${QUESTION_TYPE_LABEL[q.type] || '题目'}`)
  lines.push(`【题干】${q.stem}`)
  if (q.options && q.options.length > 0) {
    for (const opt of q.options) {
      lines.push(`【选项${opt.label}】${opt.text}`)
    }
  }
  if (q.answer && q.answer.trim()) {
    lines.push(`【参考答案】${q.answer}`)
  } else {
    lines.push('【参考答案】（题库未提供答案，请基于题干给出解答要点作为解析）')
  }
  lines.push('')
  lines.push(TYPE_HINTS[q.type] || TYPE_HINTS.OTHER)
  lines.push('请直接输出解析正文：')
  return lines.join('\n')
}

async function callLlm(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  q: QuestionRecord,
): Promise<string> {
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(q) },
        ],
        thinking: { type: 'disabled' },
      })
      const raw = (completion.choices[0]?.message?.content || '').trim()
      if (!raw) throw new Error('模型返回为空')
      // 清理可能残留的 Markdown 痕迹与引号包裹
      const cleaned = raw
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/\s*```$/, '')
        .replace(/^["'「『]/, '')
        .replace(/["'」』]$/, '')
        .trim()
      if (!cleaned) throw new Error('模型返回为空')
      return cleaned
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * attempt))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI 生成失败')
}

/**
 * POST /api/generate-explanation
 * body:
 *  - { questionId }             单题生成，返回 { explanation, id }
 *  - { bankId, limit? }         批量为缺解析的题目生成，返回 { generated, failed, remaining }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const questionId = typeof body.questionId === 'string' ? body.questionId : ''
    const bankId = typeof body.bankId === 'string' ? body.bankId : ''
    const limit =
      typeof body.limit === 'number' && body.limit > 0
        ? Math.min(Math.floor(body.limit), BATCH_LIMIT)
        : BATCH_LIMIT

    if (!questionId && !bankId) {
      return NextResponse.json({ error: '缺少 questionId 或 bankId' }, { status: 400 })
    }

    const zai = await ZAI.create()

    // ---------- 单题模式 ----------
    if (questionId) {
      const q = await db.question.findUnique({ where: { id: questionId } })
      if (!q) {
        return NextResponse.json({ error: '题目不存在' }, { status: 404 })
      }
      const explanation = await callLlm(zai, q as unknown as QuestionRecord)
      await db.question.update({ where: { id: questionId }, data: { explanation } })
      return NextResponse.json({ explanation, id: questionId })
    }

    // ---------- 批量模式 ----------
    const questions = await db.question.findMany({
      where: { bankId, OR: [{ explanation: null }, { explanation: '' }] },
      orderBy: { sortOrder: 'asc' },
      take: limit,
    })

    if (questions.length === 0) {
      return NextResponse.json({ generated: 0, failed: 0, remaining: 0 })
    }

    const remainingTotal = await db.question.count({
      where: { bankId, OR: [{ explanation: null }, { explanation: '' }] },
    })

    let generated = 0
    let failed = 0
    for (const q of questions) {
      try {
        const explanation = await callLlm(zai, q as unknown as QuestionRecord)
        await db.question.update({ where: { id: q.id }, data: { explanation } })
        generated++
      } catch {
        failed++
      }
    }

    return NextResponse.json({
      generated,
      failed,
      remaining: Math.max(remainingTotal - questions.length, 0),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 解析生成失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
