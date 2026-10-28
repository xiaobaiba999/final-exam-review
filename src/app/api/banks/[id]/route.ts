import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { QuestionType } from '@/lib/types'

export const runtime = 'nodejs'

/** GET /api/banks/[id] —— 题库详情（含全部题目） */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const bank = await db.bank.findUnique({
    where: { id },
    include: {
      questions: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!bank) {
    return NextResponse.json({ error: '题库不存在' }, { status: 404 })
  }

  const typeCounts: Partial<Record<QuestionType, number>> = {}
  let known = 0
  let wrong = 0
  let starred = 0
  for (const q of bank.questions) {
    typeCounts[q.type as QuestionType] =
      (typeCounts[q.type as QuestionType] || 0) + 1
    if (q.status === 'known') known++
    if (q.status === 'wrong') wrong++
    if (q.starred) starred++
  }

  const questions = bank.questions.map((q) => ({
    id: q.id,
    bankId: q.bankId,
    type: q.type,
    stem: q.stem,
    options: JSON.parse(q.optionsJson || '[]'),
    answer: q.answer,
    explanation: q.explanation,
    starred: q.starred,
    status: q.status,
    wrongCount: q.wrongCount,
    correctCount: q.correctCount,
    lastResult: q.lastResult,
    sortOrder: q.sortOrder,
  }))

  return NextResponse.json({
    bank: {
      id: bank.id,
      name: bank.name,
      source: bank.source,
      total: bank.questions.length,
      known,
      wrong,
      starred,
      typeCounts,
      createdAt: bank.createdAt,
    },
    questions,
  })
}

/** PATCH /api/banks/[id] —— 重命名 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: '题库名称不能为空' }, { status: 400 })
  }
  const bank = await db.bank.update({ where: { id }, data: { name } })
  return NextResponse.json({ id: bank.id, name: bank.name })
}

/** DELETE /api/banks/[id] —— 删除题库（级联删除题目） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await db.bank.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
