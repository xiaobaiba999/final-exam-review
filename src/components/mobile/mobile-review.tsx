'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

const LETTERS = 'ABCDEFGH'.split('')
const SELF_ASSESS_TYPES = ['TERM', 'SHORT_ANSWER', 'ESSAY', 'CALCULATION', 'CASE', 'OTHER']
/** 触发翻题的最小滑动距离（px） */
const SWIPE_THRESHOLD = 72

interface GradedAnswer {
  userAnswer: string
  result: 'correct' | 'wrong'
}

/** 每题的临时作答状态（按题 ID 存取，切题自动隔离） */
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

/**
 * 移动端沉浸式复习：
 * - 全屏无干扰（App 壳在此视图隐藏导航）
 * - 大触控按钮 + 吸底翻题栏（拇指区）
 * - 左右滑动卡片翻题（带实时跟手位移）
 * - AI 生成解析与桌面端逻辑一致
 */
export function MobileReview() {
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
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  /** 滑动手势状态 */
  const touchStartRef = useRef<{ x: number; y: number; axis: 'h' | 'v' | null } | null>(null)
  const [dragX, setDragX] = useState(0)

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
      toast({ title: 'AI 解析已生成', description: '已自动保存到题库' })
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

  // ---------- 滑动手势 ----------
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, axis: null }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const start = touchStartRef.current
    if (!start) return
    const t = e.touches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // 锁定主滑动方向，避免与纵向滚动冲突
    if (!start.axis) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) start.axis = 'h'
      else if (Math.abs(dy) > 12) start.axis = 'v'
      if (!start.axis) return
    }
    if (start.axis !== 'h') return
    // 边界：第一题不能右滑、最后一题不能左滑
    if ((index === 0 && dx > 0) || (index >= total - 1 && dx < 0)) {
      setDragX(0)
      return
    }
    setDragX(dx * 0.65)
  }

  const onTouchEnd = () => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (start?.axis === 'h' && Math.abs(dragX) > SWIPE_THRESHOLD) {
      if (dragX < 0) gotoNext()
      else gotoPrev()
    }
    setDragX(0)
  }

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
    setDragX(0)
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
      <section className="flex flex-col items-center gap-4 pb-28 pt-32 text-center">
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
      <div className="space-y-2.5">
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
                'flex min-h-12 w-full items-center gap-3 rounded-xl border p-3.5 text-left text-[15px] transition-colors active:scale-[0.99]',
                !showResult &&
                  'border-stone-200 bg-white hover:border-emerald-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-emerald-700',
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
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
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
      {/* 顶部迷你栏（沉浸式） */}
      <div className="safe-top sticky top-0 z-30 bg-white/95 backdrop-blur dark:bg-zinc-900/95">
        <div className="flex h-14 items-center gap-1 px-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-stone-500 hover:text-red-600 dark:text-zinc-400"
            onClick={() => setExitOpen(true)}
            aria-label="退出复习"
          >
            <X className="size-5" />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[13px] font-semibold">{session.bankName}</p>
            <p className="text-[11px] tabular-nums text-stone-400 dark:text-zinc-500">
              {modeLabel} · 第 {index + 1}/{total} 题
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            onClick={() => void toggleStar()}
            aria-label={q.starred ? '取消收藏本题' : '收藏本题'}
            aria-pressed={q.starred}
          >
            <Star
              className={cn(
                'size-5 transition-colors',
                q.starred ? 'fill-amber-400 text-amber-400' : 'text-stone-400 dark:text-zinc-500',
              )}
            />
          </Button>
        </div>
        <Progress
          value={((index + 1) / total) * 100}
          className="h-1 rounded-none bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
          aria-label={`复习进度 ${index + 1}/${total}`}
        />
      </div>

      {/* 题卡（支持滑动跟手） */}
      <div className="px-4 pb-36 pt-4">
        <article
          className={cn(
            'touch-pan-y rounded-2xl border border-stone-200/70 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900',
            dragX === 0 && 'transition-transform duration-200',
          )}
          style={{ transform: `translateX(${dragX}px)`, opacity: 1 - Math.min(Math.abs(dragX) / 400, 0.35) }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center gap-2">
            <QuestionTypeBadge type={q.type} className="text-[11px]" />
            <span className="text-xs text-stone-400 dark:text-zinc-500">
              {QUESTION_TYPE_LABEL[q.type]}
              {q.type === 'MULTIPLE' && '（多选）'}
            </span>
          </div>

          <p className="mt-3 whitespace-pre-wrap text-lg font-medium leading-relaxed text-stone-900 dark:text-zinc-50">
            {q.stem}
          </p>

          {/* ---------- 按题型交互 ---------- */}
          {(q.type === 'SINGLE' || q.type === 'MULTIPLE') && (
            <div className="mt-4 space-y-3">
              {renderOptions(q.type === 'SINGLE' ? 'single' : 'multiple')}
              {q.type === 'MULTIPLE' && !graded && (
                <Button
                  className="h-12 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                  onClick={confirmMultiple}
                  disabled={draft.selected.length === 0}
                >
                  确认答案{draft.selected.length > 0 ? `（已选 ${draft.selected.join('')}）` : '（可多选）'}
                </Button>
              )}
            </div>
          )}

          {q.type === 'TRUE_FALSE' && (
            <div className="mt-4 grid grid-cols-2 gap-3">
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
                      'h-16 rounded-xl border text-base font-semibold transition-colors active:scale-[0.98]',
                      !showResult &&
                        'border-stone-200 bg-white text-stone-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
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
              className="mt-4 space-y-3"
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
                  className="h-12 flex-1 text-base"
                />
                {!graded && !draft.revealed && (
                  <Button
                    type="submit"
                    className="h-12 bg-emerald-600 px-6 text-white shadow-sm hover:bg-emerald-700"
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
                  <div className="rounded-xl bg-stone-50 p-3.5 dark:bg-zinc-800/60">
                    <p className="mb-1 text-xs text-stone-400 dark:text-zinc-500">参考答案</p>
                    {renderAnswer(q)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="h-12 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => record('correct', draft.fillValue.trim())}
                    >
                      我答对了
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 flex-1 border-red-300 text-red-600 dark:border-red-900 dark:text-red-400"
                      onClick={() => record('wrong', draft.fillValue.trim())}
                    >
                      我答错了
                    </Button>
                  </div>
                </div>
              )}
            </form>
          )}

          {isSelfAssessType(q.type) && (
            <div className="mt-4 space-y-3">
              {!draft.revealed && !graded && (
                <div className="space-y-2 py-1">
                  <p className="text-center text-xs text-stone-400 dark:text-zinc-500">先在脑中作答，再对照答案自评</p>
                  <Button
                    className="h-12 w-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                    onClick={() => patchDraft({ revealed: true })}
                  >
                    <Eye className="size-4" />
                    显示答案
                  </Button>
                </div>
              )}
              {draft.revealed && !graded && (
                <>
                  <div className="rounded-xl bg-stone-50 p-3.5 dark:bg-zinc-800/60">
                    <p className="mb-1 text-xs text-stone-400 dark:text-zinc-500">参考答案</p>
                    {renderAnswer(q)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="h-12 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => record('correct', '自评')}
                    >
                      掌握了
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 flex-1 border-red-300 text-red-600 dark:border-red-900 dark:text-red-400"
                      onClick={() => record('wrong', '自评')}
                    >
                      没掌握
                    </Button>
                  </div>
                </>
              )}
              {graded && (
                <div className="rounded-xl bg-stone-50 p-3.5 dark:bg-zinc-800/60">
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
                'mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium',
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
            <div className="mt-3">
              {q.explanation ? (
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-stone-50/60 p-3.5 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-zinc-800/40">
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
                  className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/80 p-3.5 text-sm text-stone-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                  AI 老师正在为本题编写详细解析…
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-stone-300 bg-white/50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
                  {aiError && (
                    <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
                      {aiError}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    className="h-11 w-full border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-400"
                    onClick={() => void handleGenerateExplanation()}
                  >
                    <Sparkles className="size-4" />
                    本题暂无解析，点击 AI 生成详细解析
                  </Button>
                </div>
              )}
            </div>
          )}
        </article>

        {/* 滑动提示 */}
        <p className="mt-3 text-center text-[11px] text-stone-400 dark:text-zinc-600">
          左右滑动题卡可切换题目
        </p>
      </div>

      {/* 吸底翻题栏 */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            className="h-12 flex-1 border-stone-300 dark:border-zinc-700"
            onClick={gotoPrev}
            disabled={index === 0}
          >
            <ArrowLeft className="size-4" />
            上一题
          </Button>
          <span className="w-14 shrink-0 text-center text-xs tabular-nums text-stone-400 dark:text-zinc-500" aria-live="polite">
            {index + 1} / {total}
          </span>
          <Button
            className="h-12 flex-1 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
            onClick={gotoNext}
          >
            {index >= total - 1 ? '总结' : '下一题'}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

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
              className="h-12 sm:flex-1"
              onClick={retryWrong}
              disabled={summary.wrongQuestions.length === 0}
            >
              <RotateCcw className="size-4" />
              错题再练（{summary.wrongQuestions.length}）
            </Button>
            <Button
              className="h-12 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1"
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
