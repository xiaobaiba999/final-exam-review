import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { QUESTION_TYPE_LABEL, QuestionType } from '@/lib/types'

export const runtime = 'nodejs'

/** GET /api/stats —— 全局学习统计 */
export async function GET() {
  const banks = await db.bank.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      questions: {
        select: {
          type: true,
          status: true,
          starred: true,
          wrongCount: true,
          correctCount: true,
        },
      },
    },
  })

  let total = 0
  let known = 0
  let wrong = 0
  let starred = 0
  let totalCorrect = 0
  let totalWrong = 0
  const typeCounts: Partial<Record<QuestionType, number>> = {}

  const bankStats = banks.map((b) => {
    let bKnown = 0
    let bWrong = 0
    for (const q of b.questions) {
      total++
      typeCounts[q.type as QuestionType] =
        (typeCounts[q.type as QuestionType] || 0) + 1
      totalCorrect += q.correctCount
      totalWrong += q.wrongCount
      if (q.starred) starred++
      if (q.status === 'known') {
        known++
        bKnown++
      }
      if (q.status === 'wrong') {
        wrong++
        bWrong++
      }
    }
    return {
      id: b.id,
      name: b.name,
      total: b.questions.length,
      known: bKnown,
      wrong: bWrong,
      masteredRate:
        b.questions.length > 0
          ? Math.round((bKnown / b.questions.length) * 100)
          : 0,
    }
  })

  return NextResponse.json({
    totals: {
      banks: banks.length,
      questions: total,
      known,
      wrong,
      starred,
      newQuestions: total - known - wrong,
      totalCorrect,
      totalWrong,
      accuracy:
        totalCorrect + totalWrong > 0
          ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
          : 0,
      masteredRate: total > 0 ? Math.round((known / total) * 100) : 0,
    },
    typeCounts,
    typeLabels: QUESTION_TYPE_LABEL,
    banks: bankStats,
  })
}
