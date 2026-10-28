import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { QUESTION_TYPE_LABEL, QuestionType } from '@/lib/types'

export const runtime = 'nodejs'

const VALID_STATUSES = ['new', 'known', 'wrong']

interface PatchBody {
  type?: string
  stem?: string
  options?: { label: string; text: string }[]
  answer?: string
  explanation?: string | null
  starred?: boolean
  status?: string
  result?: 'correct' | 'wrong'
}

/** PATCH /api/questions/[id] —— 编辑题目 / 更新复习状态 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body: PatchBody = await req.json()
  const data: Record<string, unknown> = {}

  if (typeof body.stem === 'string' && body.stem.trim()) {
    data.stem = body.stem.trim()
  }
  if (body.type && body.type in QUESTION_TYPE_LABEL) {
    data.type = body.type as QuestionType
  }
  if (Array.isArray(body.options)) {
    data.optionsJson = JSON.stringify(
      body.options.filter((o) => o && typeof o.text === 'string' && o.text.trim()),
    )
  }
  if (typeof body.answer === 'string') {
    data.answer = body.answer.trim()
  }
  if (body.explanation !== undefined) {
    data.explanation =
      typeof body.explanation === 'string' && body.explanation.trim()
        ? body.explanation.trim()
        : null
  }
  if (typeof body.starred === 'boolean') {
    data.starred = body.starred
  }
  if (body.status && VALID_STATUSES.includes(body.status)) {
    data.status = body.status
  }
  if (body.result === 'correct') {
    data.status = 'known'
    data.lastResult = 'correct'
    data.correctCount = { increment: 1 }
  } else if (body.result === 'wrong') {
    data.status = 'wrong'
    data.lastResult = 'wrong'
    data.wrongCount = { increment: 1 }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 })
  }

  const question = await db.question.update({ where: { id }, data })
  return NextResponse.json({
    id: question.id,
    type: question.type,
    starred: question.starred,
    status: question.status,
    wrongCount: question.wrongCount,
    correctCount: question.correctCount,
  })
}

/** DELETE /api/questions/[id] —— 删除题目 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await db.question.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
