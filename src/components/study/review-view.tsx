'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Eye,
  Loader2,
  LogOut,
  RotateCcw,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { generateExplanation, updateQuestion } from '@/lib/api-client'
import {
  normalizeChoiceAnswer,
  normalizeTextForCompare,
  normalizeTrueFalse,
  QUESTION_TYPE_LABEL,
  REVIEW_MODE_LABEL,
  type ParsedQuestion,
  type QuestionRecord,
} from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

const LETTERS = 'ABCDEFGH'.split('')
const SELF_ASSESS_TYPES = ['TERM', 'SHORT_ANSWER', 'ESSAY', 'CALCULATION', 'CASE', 'OTHER']

interface GradedAnswer {
  userAnswer: string
  result: 'correct' | 'wrong'
}

/** 每题的临时作答状态（按题 ID 存取，切题自动隔离，无需重置） */
interface QuestionDraft {
  selected: string[]
  fillValue: string
  revealed: boolean
}

const EMPTY_DRAFT: QuestionDraft = { selected: [], fillValue: '', revealed: false }

function isSelfAssessType(type: string): boolean {
  return SELF_ASSESS_TYPES.includes(type)
}

/** 判断题展示文案：存储值为 对/错，界面显示 正确/错误 */
function tfDisplay(v: '对' | '错'): string {
  return v === '对' ? '正确' : '错误'
}

export function ReviewView() {
  const session = useAppStore((s) => s.session)
  const setView = useAppStore((s) => s.setView)
  const endReview = useAppStore((s) => s.endReview)
  const updateSessionQuestion = useAppStore((s) => s.updateSessionQuestion)
  const startReview = useAppStore((s) => s.startReview)

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, GradedAnswer>>({})
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({})
  const [exitOpen, setExitOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [wrongListOpen, setWrongListOpen] = useState(true)
  /** 正在生成 AI 解析的题目 ID（null 表示空闲） */
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const total = session?.questions.length ?? 0

  // 无会话时回题库首页
  useEffect(() => {
    if (!session) setView('banks')
  }, [session, setView])

  const q: QuestionRecord | undefined = session?.questions[index]
  const draft: QuestionDraft = (q && drafts[q.id]) || EMPTY_DRAFT

  const correctSet = useMemo(
    () => new Set(q ? normalizeChoiceAnswer(q.answer) : []),
    [q],
  )

  /** 更新当前题目的临时作答状态 */
  const patchDraft = useCallback(
    (patch: Partial<QuestionDraft>) => {
      if (!q) return
      setDrafts((prev) => ({
        ...prev,
        [q.id]: { ...EMPTY_DRAFT, ...prev[q.id], ...patch },
      }))
    },
    [q],
  )

  const record = useCallback(
    (result: 'correct' | 'wrong', userAnswer: string) => {
      if (!q) return
      setAnswers((prev) => ({ ...prev, [q.id]: { userAnswer, result } }))
      updateSessionQuestion(q.id, {
        status: result === 'correct' ? 'known' : 'wrong',
        lastResult: result,
        correctCount: q.correctCount + (result === 'correct' ? 1 : 0),
        wrongCount: q.wrongCount + (result === 'wrong' ? 1 : 0),
      })
      updateQuestion(q.id, { result }).catch((e: unknown) => {
        toast({
          title: '结果同步失败',
          description: e instanceof Error ? e.message : '答题结果未能保存到服务器',
          variant: 'destructive',
        })
      })
    },
    [q, updateSessionQuestion],
  )

  const handleOptionClick = useCallback(
    (letter: string) => {
      if (!q || answers[q.id]) return
      if (q.type === 'SINGLE') {
        record(correctSet.has(letter) ? 'correct' : 'wrong', letter)
      } else if (q.type === 'MULTIPLE') {
        const cur = drafts[q.id] || EMPTY_DRAFT
        const nextSelected = cur.selected.includes(letter)
          ? cur.selected.filter((l) => l !== letter)
          : [...cur.selected, letter].sort()
        patchDraft({ selected: nextSelected })
      }
    },
    [q, answers, correctSet, drafts, record, patchDraft],
  )

  const confirmMultiple = useCallback(() => {
    if (!q || answers[q.id]) return
    const picked = draft.selected
    if (picked.length === 0) return
    const isCorrect =
      picked.length === correctSet.size && picked.every((l) => correctSet.has(l))
    record(isCorrect ? 'correct' : 'wrong', picked.join(''))
  }, [q, answers, draft.selected, correctSet, record])

  const handleTfClick = useCallback(
    (val: '对' | '错') => {
      if (!q || answers[q.id]) return
      record(val === normalizeTrueFalse(q.answer) ? 'correct' : 'wrong', val)
    },
    [q, answers, record],
  )

  const handleFillSubmit = useCallback(() => {
    if (!q || answers[q.id] || !draft.fillValue.trim()) return
    if (normalizeTextForCompare(draft.fillValue) === normalizeTextForCompare(q.answer)) {
      record('correct', draft.fillValue.trim())
    } else {
      patchDraft({ revealed: true })
    }
  }, [q, answers, draft.fillValue, record, patchDraft])

  const toggleStar = useCallback(async () => {
    if (!q) return
    const next = !q.starred
    updateSessionQuestion(q.id, { starred: next })
    try {
      await updateQuestion(q.id, { starred: next })
    } catch (e) {
      updateSessionQuestion(q.id, { starred: !next })
      toast({
        title: '收藏失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }, [q, updateSessionQuestion])

  /** AI 生成当前题目的详细解析（成功后写回会话，立即展示） */
  const handleGenerateExplanation = useCallback(async () => {
    if (!q || aiLoadingId) return
    setAiLoadingId(q.id)
    setAiError(null)
    try {
      const { explanation } = await generateExplanation(q.id)
      updateSessionQuestion(q.id, { explanation })
      toast({ title: 'AI 解析已生成', description: '已自动保存到题库，复习时可随时查看' })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : '生成失败，请重试')
    } finally {
      setAiLoadingId(null)
    }
  }, [q, aiLoadingId, updateSessionQuestion])

  const gotoNext = useCallback(() => {
    if (total === 0) return
    setAiError(null)
    if (index < total - 1) setIndex((i) => i + 1)
    else setSummaryOpen(true)
  }, [index, total])

  const gotoPrev = useCallback(() => {
    setAiError(null)
    if (index > 0) setIndex((i) => i - 1)
  }, [index])

  const graded: GradedAnswer | undefined = q ? answers[q.id] : undefined

  // Space/Enter：显示答案或下一题
  const handlePrimaryAction = useCallback(() => {
    if (!q || graded) {
      gotoNext()
      return
    }
    if ((isSelfAssessType(q.type) || q.type === 'FILL_BLANK') && !draft.revealed) {
      patchDraft({ revealed: true })
      return
    }
    // 其余情况需要先作答，不做动作
  }, [q, graded, draft.revealed, patchDraft, gotoNext])

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (summaryOpen || exitOpen || !session) return

      const key = e.key
      if (key === ' ' || key === 'Enter') {
        e.preventDefault()
        handlePrimaryAction()
        return
      }
      if (key === 'ArrowLeft') {
        e.preventDefault()
        gotoPrev()
        return
      }
      if (key === 'ArrowRight') {
        e.preventDefault()
        gotoNext()
        return
      }
      const lower = key.toLowerCase()
      if (lower === 's') {
        void toggleStar()
        return
      }
      if (!q || graded) return

      // 1-8 / A-H 选择选项
      if (q.type === 'SINGLE' || q.type === 'MULTIPLE') {
        const digitIdx = '12345678'.indexOf(key)
        if (digitIdx >= 0) {
          handleOptionClick(LETTERS[digitIdx])
          return
        }
        if (/^[a-hA-H]$/.test(key)) {
          handleOptionClick(key.toUpperCase())
          return
        }
      }
      // 自评：1=掌握/答对 2=未掌握/答错
      if ((isSelfAssessType(q.type) || (q.type === 'FILL_BLANK' && draft.revealed)) && !graded) {
        if (key === '1') record('correct', '自评')
        if (key === '2') record('wrong', '自评')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    summaryOpen,
    exitOpen,
    session,
    q,
    graded,
    draft.revealed,
    handlePrimaryAction,
    gotoPrev,
    gotoNext,
    toggleStar,
    handleOptionClick,
    record,
  ])

  // ---------- 汇总 ----------
  const summary = useMemo(() => {
    if (!session) return { correct: 0, wrong: 0, unanswered: 0, accuracy: 0, wrongQuestions: [] as QuestionRecord[] }
    let correct = 0
    let wrong = 0
    const wrongQuestions: QuestionRecord[] = []
    for (const item of session.questions) {
      const g = answers[item.id]
      if (!g) continue
      if (g.result === 'correct') correct++
      else {
        wrong++
        wrongQuestions.push(item)
      }
    }
    const answered = correct + wrong
    return {
      correct,
      wrong,
      unanswered: session.questions.length - answered,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      wrongQuestions,
    }
  }, [session, answers])

  const retryWrong = useCallback(() => {
    if (!session || summary.wrongQuestions.length === 0) return
    setSummaryOpen(false)
    setAnswers({})
    setDrafts({})
    setIndex(0)
    startReview({
      bankId: session.bankId,
      bankName: session.bankName,
      mode: 'WRONG',
      typeFilter: null,
      questions: summary.wrongQuestions,
    })
  }, [session, summary.wrongQuestions, startReview])

  // ---------- 渲染 ----------
  if (!session) return null

  if (total === 0 || !q) {
    return (
      <section className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-stone-500 dark:text-zinc-400">本次复习没有题目</p>
        <Button className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => endReview()}>
          返回
        </Button>
      </section>
    )
  }

  const modeLabel =
    session.mode === 'BY_TYPE' && session.typeFilter
      ? `${REVIEW_MODE_LABEL[session.mode]} · ${QUESTION_TYPE_LABEL[session.typeFilter]}`
      : REVIEW_MODE_LABEL[session.mode]

  /** 参考答案展示（按题型） */
  const renderAnswer = (question: QuestionRecord | ParsedQuestion) => {
    if (question.type === 'SINGLE' || question.type === 'MULTIPLE') {
      const keys = normalizeChoiceAnswer(question.answer)
      if (keys.length === 0) return <span>{question.answer || '（未识别到答案）'}</span>
      return (
        <div className="space-y-1">
          {keys.map((k) => {
            const opt = question.options.find((o) => o.label === k)
            return (
              <p key={k} className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {k}. {opt?.text || ''}
              </p>
            )
          })}
        </div>
      )
    }
    if (question.type === 'TRUE_FALSE') {
      return <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{tfDisplay(normalizeTrueFalse(question.answer))}</span>
    }
    return <p className="whitespace-pre-wrap text-sm font-medium text-emerald-700 dark:text-emerald-300">{question.answer || '（未识别到答案）'}</p>
  }

  const renderOptions = (kind: 'single' | 'multiple') => {
    const pickedSet = new Set<string>(
      graded && kind === 'multiple'
        ? graded.userAnswer.split('')
        : graded
          ? [graded.userAnswer]
          : draft.selected,
    )
    return (
      <div className="space-y-2">
        {q.options.map((o) => {
          const isCorrect = correctSet.has(o.label)
          const isPicked = pickedSet.has(o.label)
          const showResult = !!graded
          return (
            <button
              key={o.label}
              type="button"
              disabled={!!graded}
              onClick={() => handleOptionClick(o.label)}
              aria-label={`选项 ${o.label}`}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors',
                !showResult &&
                  'border-stone-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30',
                !showResult && kind === 'multiple' && isPicked &&
                  'border-emerald-500 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/50',
                showResult && isCorrect &&
                  'border-emerald-500 bg-emerald-100/80 dark:border-emerald-700 dark:bg-emerald-950/60',
                showResult && isPicked && !isCorrect &&
                  'border-red-400 bg-red-100/80 dark:border-red-800 dark:bg-red-950/50',
                showResult && !isCorrect && !isPicked && 'opacity-55',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  !showResult && !isPicked &&
                    'border-stone-300 text-stone-500 dark:border-zinc-600 dark:text-zinc-400',
                  !showResult && isPicked && 'border-emerald-500 bg-emerald-500 text-white',
                  showResult && isCorrect && 'border-emerald-600 bg-emerald-600 text-white',
                  showResult && isPicked && !isCorrect && 'border-red-500 bg-red-500 text-white',
                  showResult && !isCorrect && !isPicked &&
                    'border-stone-300 text-stone-500 dark:border-zinc-600 dark:text-zinc-400',
                )}
              >
                {o.label}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed text-stone-800 dark:text-zinc-200">
                {o.text}
              </span>
              {showResult && isCorrect && <Check className="size-4 shrink-0 text-emerald-600" />}
              {showResult && isPicked && !isCorrect && <X className="size-4 shrink-0 text-red-500" />}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <section aria-label="复习进行中" className="animate-in fade-in duration-300">
      {/* 顶部：进度 + 控制 */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {modeLabel}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-zinc-400">
            {session.bankName} · 第 {index + 1}/{total} 题
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => void toggleStar()}
              aria-label={q.starred ? '取消收藏本题' : '收藏本题'}
              aria-pressed={q.starred}
            >
              <Star
                className={cn(
                  'size-4 transition-colors',
                  q.starred ? 'fill-amber-400 text-amber-400' : 'text-stone-400 dark:text-zinc-500',
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-stone-500 hover:text-red-600 dark:text-zinc-400"
              onClick={() => setExitOpen(true)}
              aria-label="退出复习"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        <Progress
          value={((index + 1) / total) * 100}
          className="h-2 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
          aria-label={`复习进度 ${index + 1}/${total}`}
        />
      </div>

      {/* 题卡 */}
      <Card className="mx-auto mt-6 max-w-2xl gap-4 rounded-2xl bg-white py-6 shadow-sm dark:bg-zinc-900">
        <CardContent className="space-y-5 px-5 sm:px-6">
          <div className="flex items-center gap-2">
            <QuestionTypeBadge type={q.type} className="text-[11px]" />
            <span className="text-xs text-stone-400 dark:text-zinc-500">
              {QUESTION_TYPE_LABEL[q.type]}
              {q.type === 'MULTIPLE' && '（多选）'}
            </span>
          </div>

          <p className="whitespace-pre-wrap text-lg font-medium leading-relaxed text-stone-900 dark:text-zinc-50">
            {q.stem}
          </p>

          {/* ---------- 按题型交互 ---------- */}
          {(q.type === 'SINGLE' || q.type === 'MULTIPLE') && (
            <div className="space-y-3">
              {renderOptions(q.type === 'SINGLE' ? 'single' : 'multiple')}
              {q.type === 'MULTIPLE' && !graded && (
                <Button
                  className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                  onClick={confirmMultiple}
                  disabled={draft.selected.length === 0}
                >
                  确认答案{draft.selected.length > 0 ? `（已选 ${draft.selected.join('')}）` : '（可多选）'}
                </Button>
              )}
            </div>
          )}

          {q.type === 'TRUE_FALSE' && (
            <div className="grid grid-cols-2 gap-3">
              {(['对', '错'] as const).map((val) => {
                const isCorrect = normalizeTrueFalse(q.answer) === val
                const isPicked = graded ? graded.userAnswer === val : false
                const showResult = !!graded
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={showResult}
                    onClick={() => handleTfClick(val)}
                    aria-label={tfDisplay(val)}
                    className={cn(
                      'min-h-14 rounded-xl border text-base font-semibold transition-colors',
                      !showResult &&
                        'border-stone-200 bg-white text-stone-700 hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30',
                      showResult && isCorrect && 'border-emerald-500 bg-emerald-100/80 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
                      showResult && isPicked && !isCorrect && 'border-red-400 bg-red-100/80 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300',
                      showResult && !isCorrect && !isPicked && 'opacity-55',
                    )}
                  >
                    {tfDisplay(val)}
                  </button>
                )
              })}
            </div>
          )}

          {q.type === 'FILL_BLANK' && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                handleFillSubmit()
              }}
            >
              <div className="flex gap-2">
                <Input
                  value={draft.fillValue}
                  onChange={(e) => patchDraft({ fillValue: e.target.value })}
                  disabled={!!graded || draft.revealed}
                  placeholder="输入你的答案…"
                  aria-label="填空答案输入"
                  className="h-11 flex-1"
                />
                {!graded && !draft.revealed && (
                  <Button
                    type="submit"
                    className="h-11 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                    disabled={!draft.fillValue.trim()}
                  >
                    确认
                  </Button>
                )}
              </div>
              {graded && (
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  你的答案：<span className="font-medium text-stone-700 dark:text-zinc-200">{graded.userAnswer || '（空）'}</span>
                </p>
              )}
              {draft.revealed && !graded && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-stone-50 p-4 dark:bg-zinc-800/60">
                    <p className="mb-1 text-xs text-stone-400 dark:text-zinc-500">参考答案</p>
                    {renderAnswer(q)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => record('correct', draft.fillValue.trim())}
                    >
                      我答对了（1）
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 flex-1 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => record('wrong', draft.fillValue.trim())}
                    >
                      我答错了（2）
                    </Button>
                  </div>
                </div>
              )}
            </form>
          )}

          {isSelfAssessType(q.type) && (
            <div className="space-y-3">
              {!draft.revealed && !graded && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <p className="text-xs text-stone-400 dark:text-zinc-500">先在脑中作答，再对照答案自评</p>
                  <Button
                    className="h-11 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 sm:w-auto sm:px-10"
                    onClick={() => patchDraft({ revealed: true })}
                  >
                    <Eye className="size-4" />
                    显示答案（Space）
                  </Button>
                </div>
              )}
              {draft.revealed && !graded && (
                <>
                  <div className="rounded-lg bg-stone-50 p-4 dark:bg-zinc-800/60">
                    <p className="mb-1 text-xs text-stone-400 dark:text-zinc-500">参考答案</p>
                    {renderAnswer(q)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => record('correct', '自评')}
                    >
                      掌握了（1）
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 flex-1 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => record('wrong', '自评')}
                    >
                      没掌握（2）
                    </Button>
                  </div>
                </>
              )}
              {graded && (
                <div className="rounded-lg bg-stone-50 p-4 dark:bg-zinc-800/60">
                  <p className="mb-1 text-xs text-stone-400 dark:text-zinc-500">参考答案</p>
                  {renderAnswer(q)}
                </div>
              )}
            </div>
          )}

          {/* ---------- 判分结果 ---------- */}
          {graded && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                graded.result === 'correct'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300',
              )}
              role="status"
            >
              {graded.result === 'correct' ? (
                <>
                  <CircleCheck className="size-4" />
                  回答正确
                </>
              ) : (
                <>
                  <CircleX className="size-4" />
                  回答错误
                  {(q.type === 'SINGLE' || q.type === 'MULTIPLE') && (
                    <span className="font-normal">正确答案：{normalizeChoiceAnswer(q.answer).join('、') || q.answer}</span>
                  )}
                  {q.type === 'TRUE_FALSE' && (
                    <span className="font-normal">正确答案：{tfDisplay(normalizeTrueFalse(q.answer))}</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* 解析 / AI 生成解析 */}
          {(graded || (draft.revealed && isSelfAssessType(q.type))) && (
            q.explanation ? (
              <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-stone-50/60 p-4 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-zinc-800/40">
                <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <BookOpen className="size-3.5" />
                  题目解析
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-zinc-300">
                  {q.explanation}
                </p>
              </div>
            ) : aiLoadingId === q.id ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                AI 老师正在为本题编写详细解析…
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
                {aiError && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
                    {aiError}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="h-11 w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  onClick={() => void handleGenerateExplanation()}
                >
                  <Sparkles className="size-4" />
                  本题暂无解析，点击 AI 生成详细解析
                </Button>
              </div>
            )
          )}

          {/* 主 CTA */}
          {graded && (
            <Button
              className="h-12 w-full bg-emerald-600 text-base text-white shadow-sm hover:bg-emerald-700"
              onClick={gotoNext}
            >
              {index < total - 1 ? (
                <>
                  下一题
                  <ArrowRight className="size-4" />
                </>
              ) : (
                <>
                  查看本次总结
                  <Check className="size-4" />
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 底部翻页 */}
      <div className="mx-auto mt-4 flex max-w-2xl items-center justify-between">
        <Button variant="outline" className="h-11" onClick={gotoPrev} disabled={index === 0}>
          <ArrowLeft className="size-4" />
          上一题
        </Button>
        <span className="text-xs tabular-nums text-stone-400 dark:text-zinc-500">
          {index + 1} / {total}
        </span>
        <Button
          variant="outline"
          className="h-11"
          onClick={gotoNext}
          disabled={index >= total - 1}
          aria-label={index >= total - 1 ? '查看总结' : '下一题'}
        >
          {index >= total - 1 ? '总结' : '下一题'}
          <ArrowRight className="size-4" />
        </Button>
      </div>

      <p className="mx-auto mt-3 max-w-2xl text-center text-[11px] text-stone-400 dark:text-zinc-600">
        快捷键：Space/Enter 显示答案或下一题 · ←/→ 翻题 · A-H 或 1-8 选择 · S 收藏
      </p>

      {/* 退出确认 */}
      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定退出本次复习吗？</AlertDialogTitle>
            <AlertDialogDescription>
              已作答 {Object.keys(answers).length} 题，结果已保存。退出后将返回复习设置页。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续复习</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => endReview()}>
              退出复习
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 结束总结 */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto custom-scrollbar sm:max-w-md">
          <DialogHeader>
            <DialogTitle>本次复习总结</DialogTitle>
            <DialogDescription>
              {REVIEW_MODE_LABEL[session.mode]} · {session.bankName}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            <div className="relative">
              <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
                <circle cx="64" cy="64" r="54" fill="none" strokeWidth="11" className="stroke-stone-200 dark:stroke-zinc-800" />
                <circle
                  cx="64"
                  cy="64"
                  r="54"
                  fill="none"
                  strokeWidth="11"
                  strokeLinecap="round"
                  className="stroke-emerald-500 transition-all duration-700"
                  strokeDasharray={2 * Math.PI * 54}
                  strokeDashoffset={2 * Math.PI * 54 * (1 - summary.accuracy / 100)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {summary.accuracy}%
                </span>
                <span className="text-[11px] text-stone-400 dark:text-zinc-500">正确率</span>
              </div>
            </div>

            <div className="grid w-full grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-stone-50 py-2 dark:bg-zinc-800/60">
                <p className="text-lg font-bold tabular-nums">{total}</p>
                <p className="text-[11px] text-stone-500 dark:text-zinc-400">本次复习</p>
              </div>
              <div className="rounded-lg bg-emerald-50 py-2 dark:bg-emerald-950/40">
                <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{summary.correct}</p>
                <p className="text-[11px] text-stone-500 dark:text-zinc-400">答对</p>
              </div>
              <div className="rounded-lg bg-red-50 py-2 dark:bg-red-950/40">
                <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">{summary.wrong}</p>
                <p className="text-[11px] text-stone-500 dark:text-zinc-400">答错</p>
              </div>
            </div>

            {summary.unanswered > 0 && (
              <p className="text-xs text-stone-400 dark:text-zinc-500">有 {summary.unanswered} 题未作答，不计入正确率</p>
            )}

            {summary.wrongQuestions.length > 0 && (
              <div className="w-full rounded-lg border border-stone-200 dark:border-zinc-800">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-medium"
                  onClick={() => setWrongListOpen((v) => !v)}
                  aria-expanded={wrongListOpen}
                >
                  本次错题（{summary.wrongQuestions.length}）
                  {wrongListOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                {wrongListOpen && (
                  <div className="custom-scrollbar max-h-40 space-y-2 overflow-y-auto border-t border-stone-200 p-3 dark:border-zinc-800">
                    {summary.wrongQuestions.map((wq) => (
                      <div key={wq.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-red-100 text-[10px] text-red-600 dark:bg-red-950 dark:text-red-400">
                          ✗
                        </span>
                        <p className="line-clamp-2 flex-1 text-stone-600 dark:text-zinc-300">{wq.stem}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="h-11 sm:flex-1"
              onClick={retryWrong}
              disabled={summary.wrongQuestions.length === 0}
            >
              <RotateCcw className="size-4" />
              错题再练（{summary.wrongQuestions.length}）
            </Button>
            <Button
              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1"
              onClick={() => endReview()}
            >
              返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
