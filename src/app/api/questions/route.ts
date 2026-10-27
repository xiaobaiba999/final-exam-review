// 题库 CRUD
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ParsedQuestion, isQuestionType } from '@/lib/types'

export const runtime = 'nodejs'

// GET /api/questions -> 全部题目
export async function GET() {
  const rows = await db.question.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const questions = rows.map((r) => ({
    id: r.id,
    type: r.type,
    stem: r.stem,
    options: safeOptions(r.options),
    answer: r.answer,
    explanation: r.explanation,
    source: r.source,
    createdAt: r.createdAt,
    starred: r.starred,
    wrong: r.wrong,
    rightCount: r.rightCount,
    wrongCount: r.wrongCount,
  }))
  return Response.json({ questions, total: questions.length })
}

// POST /api/questions  body: { questions: ParsedQuestion[], source: string }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { questions?: ParsedQuestion[]; source?: string }
    const list = Array.isArray(body.questions) ? body.questions : []
    const source = String(body.source ?? '').slice(0, 200)
    const valid = list.filter((q) => q && isQuestionType(String(q.type)) && q.stem?.trim())
    if (valid.length === 0) {
      return Response.json({ error: '没有可导入的题目' }, { status: 400 })
    }
    await db.question.createMany({
      data: valid.map((q) => ({
        type: q.type,
        stem: q.stem.trim(),
        options: JSON.stringify(q.options ?? []),
        answer: String(q.answer ?? ''),
        explanation: String(q.explanation ?? ''),
        source,
      })),
    })
    return Response.json({ imported: valid.length })
  } catch (e) {
    console.error('[questions] POST fail', e)
    return Response.json({ error: '导入失败，请重试' }, { status: 500 })
  }
}

// PATCH /api/questions  body: { id: string, action: QuestionAction }
// star/unstar 收藏；markWrong 答错入错题本（计数+1）；markRight 答对出本（计数+1）；removeWrong 手动移出错题本
const ACTIONS = new Set(['star', 'unstar', 'markWrong', 'markRight', 'removeWrong'])
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string }
    const id = String(body.id ?? '')
    const action = String(body.action ?? '')
    if (!id || !ACTIONS.has(action)) {
      return Response.json({ error: '参数错误' }, { status: 400 })
    }
    const data:
      | { starred: boolean }
      | { wrong: boolean }
      | { wrong: boolean; wrongCount: { increment: number } }
      | { wrong: boolean; rightCount: { increment: number } } =
      action === 'star'
        ? { starred: true }
        : action === 'unstar'
          ? { starred: false }
          : action === 'markWrong'
            ? { wrong: true, wrongCount: { increment: 1 } }
            : action === 'markRight'
              ? { wrong: false, rightCount: { increment: 1 } }
              : { wrong: false }
    const row = await db.question.update({ where: { id }, data })
    return Response.json({
      starred: row.starred,
      wrong: row.wrong,
      rightCount: row.rightCount,
      wrongCount: row.wrongCount,
    })
  } catch (e) {
    console.error('[questions] PATCH fail', e)
    return Response.json({ error: '操作失败，请重试' }, { status: 500 })
  }
}

// DELETE /api/questions?all=1 清空；?id=xxx 删除单题
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('all') === '1') {
    await db.question.deleteMany({})
    return Response.json({ ok: true, cleared: true })
  }
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: '缺少 id' }, { status: 400 })
  await db.question.delete({ where: { id } }).catch(() => null)
  return Response.json({ ok: true })
}

function safeOptions(json: string): Array<{ key: string; text: string }> {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
