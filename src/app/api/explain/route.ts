// AI 解析补全：为缺少解析的题目批量生成解析
// POST /api/explain  body: { limit?: number }  处理最旧的 limit 道缺解析题
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { chatSafe, createRateGuard } from '@/lib/ai'
import { TYPE_LABELS, QuestionType } from '@/lib/types'

export const runtime = 'nodejs'
// 云平台（如 Vercel Hobby）单次函数时长上限常见为 60s
export const maxDuration = 60

const BATCH = 4

const SYSTEM = `你是考试解析生成器。为每道题生成简明准确的解析，规则：
1. 解析需指出正确答案及其依据，1-3 句话，不超过 120 字。
2. 单选题若选项内容已知，需说明为何选它；判断题说明判断依据。
3. 填空/简答题给出答案要点或评分关键词。
4. 题目本身没有标准答案时，依据专业知识给出最可信的答案并解析。
5. 只输出 JSON：{"items":[{"id":"题目id","answer":"答案","explanation":"解析"}]}，不要解释文字。`

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: number }
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 12)

    const missing = await db.question.findMany({
      where: { explanation: '' },
      orderBy: { createdAt: 'asc' },
      take: limit * BATCH,
    })
    if (missing.length === 0) {
      return Response.json({ updated: 0, remaining: 0 })
    }

    const guard = createRateGuard()
    let updated = 0
    for (let i = 0; i < missing.length; i += BATCH) {
      if (updated >= limit) break
      const group = missing.slice(i, i + BATCH)
      const payload = group.map((q) => ({
        id: q.id,
        type: TYPE_LABELS[q.type as QuestionType] ?? q.type,
        stem: q.stem,
        options: safeOptions(q.options),
        answer: q.answer,
      }))
      try {
        const raw = await chatSafe(
          [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: JSON.stringify({ items: payload }) },
          ],
          { guard }
        )
        const parsed = extractJsonArr(raw)
        for (const item of parsed) {
          const q = group.find((g) => g.id === item.id)
          if (!q) continue
          const explanation = String(item.explanation ?? '').trim()
          const answer = String(item.answer ?? '').trim()
          if (!explanation && !answer) continue
          await db.question.update({
            where: { id: q.id },
            data: {
              explanation: explanation || q.explanation,
              // 仅当原答案为空时才采纳 AI 答案，绝不覆盖原有答案
              answer: q.answer.trim() ? q.answer : answer,
            },
          })
          updated++
        }
      } catch (e) {
        console.error('[explain] batch fail', e)
        break
      }
    }

    const remaining = await db.question.count({ where: { explanation: '' } })
    return Response.json({ updated, remaining })
  } catch (e) {
    console.error('[explain] fail', e)
    return Response.json({ error: '解析生成失败，请重试' }, { status: 500 })
  }
}

function extractJsonArr(raw: string): Array<{ id?: string; answer?: string; explanation?: string }> {
  const text = raw ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const obj = JSON.parse(m[0])
    return Array.isArray(obj?.items) ? obj.items : []
  } catch {
    return []
  }
}

function safeOptions(json: string): Array<{ key: string; text: string }> {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
