import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { ParsedQuestion, QuestionType } from '@/lib/types'

export const runtime = 'nodejs'

/** GET /api/banks —— 题库列表（含统计） */
export async function GET() {
  const banks = await db.bank.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      questions: {
        select: {
          type: true,
          status: true,
          starred: true,
        },
      },
    },
  })

  const result = banks.map((b) => {
    const typeCounts: Partial<Record<QuestionType, number>> = {}
    let known = 0
    let wrong = 0
    let starred = 0
    for (const q of b.questions) {
      typeCounts[q.type as QuestionType] =
        (typeCounts[q.type as QuestionType] || 0) + 1
      if (q.status === 'known') known++
      if (q.status === 'wrong') wrong++
      if (q.starred) starred++
    }
    return {
      id: b.id,
      name: b.name,
      source: b.source,
      total: b.questions.length,
      known,
      wrong,
      starred,
      typeCounts,
      createdAt: b.createdAt,
    }
  })

  return NextResponse.json(result)
}

/** POST /api/banks —— 创建题库并批量导入题目 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '未命名题库'
    const source = typeof body.source === 'string' ? body.source : null
    const questions: ParsedQuestion[] = Array.isArray(body.questions)
      ? body.questions
      : []
    if (questions.length === 0) {
      return NextResponse.json({ error: '至少需要一道题目' }, { status: 400 })
    }

    const valid = questions.filter(
      (q) => q && typeof q.stem === 'string' && q.stem.trim(),
    )

    const bank = await db.bank.create({
      data: {
        name,
        source,
        questions: {
          create: valid.map((q, i) => ({
            type: q.type || 'OTHER',
            stem: q.stem.trim(),
            optionsJson: JSON.stringify(
              Array.isArray(q.options)
                ? q.options.filter(
                    (o) => o && typeof o.text === 'string' && o.text.trim(),
                  )
                : [],
            ),
            answer: typeof q.answer === 'string' ? q.answer.trim() : '',
            explanation: q.explanation?.trim() || null,
            sortOrder: i,
          })),
        },
      },
      include: { questions: true },
    })

    return NextResponse.json({
      id: bank.id,
      name: bank.name,
      total: bank.questions.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
