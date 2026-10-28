'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CircleAlert,
  ListOrdered,
  PlayCircle,
  Shuffle,
  Star,
  Target,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { getBank, type BankDetail } from '@/lib/api-client'
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  REVIEW_MODE_DESC,
  REVIEW_MODE_LABEL,
  type QuestionRecord,
  type QuestionType,
  type ReviewMode,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const MODE_META: { mode: ReviewMode; icon: LucideIcon; tone: string }[] = [
  { mode: 'ORDER', icon: ListOrdered, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950' },
  { mode: 'SHUFFLE', icon: Shuffle, tone: 'text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-950' },
  { mode: 'BY_TYPE', icon: Target, tone: 'text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-950' },
  { mode: 'WRONG', icon: AlertCircle, tone: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950' },
  { mode: 'STARRED', icon: Star, tone: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950' },
  { mode: 'SMART', icon: Brain, tone: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-950' },
]

const LIMIT_OPTIONS = ['ALL', '10', '20', '30', '50'] as const

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 移动端复习设置：模式行列表 + 题型/数量 chips + 吸底开始栏 */
export function MobileSetup() {
  const activeBankId = useAppStore((s) => s.activeBankId)
  const activeBankName = useAppStore((s) => s.activeBankName)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const setView = useAppStore((s) => s.setView)
  const startReview = useAppStore((s) => s.startReview)

  const [detail, setDetail] = useState<BankDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ReviewMode>('ORDER')
  const [typeFilter, setTypeFilter] = useState<QuestionType | null>(null)
  const [limit, setLimit] = useState<string>('ALL')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!activeBankId) {
        if (!cancelled) setLoading(false)
        return
      }
      if (!cancelled) setLoading(true)
      try {
        const d = await getBank(activeBankId)
        if (!cancelled) {
          setDetail(d)
          setError(null)
          const firstType = QUESTION_TYPE_ORDER.find((t) => d.questions.some((qq) => qq.type === t))
          setTypeFilter(firstType ?? null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载题库失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeBankId, dataVersion])

  const questions = useMemo(() => detail?.questions || [], [detail])

  const poolOf = useCallback(
    (m: ReviewMode, tf: QuestionType | null): QuestionRecord[] => {
      switch (m) {
        case 'WRONG':
          return questions.filter((q) => q.status === 'wrong')
        case 'STARRED':
          return questions.filter((q) => q.starred)
        case 'BY_TYPE':
          return tf ? questions.filter((q) => q.type === tf) : []
        case 'SMART':
          return questions.filter((q) => q.status !== 'known')
        default:
          return questions
      }
    },
    [questions],
  )

  const typeCounts = useMemo(() => {
    const map = new Map<QuestionType, number>()
    for (const q of questions) map.set(q.type, (map.get(q.type) || 0) + 1)
    return map
  }, [questions])

  const pool = poolOf(mode, typeFilter)

  const finalQuestions = useMemo(() => {
    const bySort = [...pool].sort((a, b) => a.sortOrder - b.sortOrder)
    let list = bySort
    if (mode === 'SHUFFLE') {
      list = shuffle(bySort)
    } else if (mode === 'SMART') {
      const wrongs = shuffle(bySort.filter((q) => q.status === 'wrong'))
      const rest = shuffle(bySort.filter((q) => q.status !== 'wrong'))
      list = [...wrongs, ...rest]
    }
    if (limit !== 'ALL') {
      const n = Number(limit)
      if (Number.isFinite(n) && n > 0) list = list.slice(0, n)
    }
    return list
  }, [pool, mode, limit])

  const handleStart = () => {
    if (!detail) return
    if (finalQuestions.length === 0) {
      toast({ title: '没有可复习的题目', description: '换个模式或调整筛选条件试试', variant: 'destructive' })
      return
    }
    startReview({
      bankId: detail.bank.id,
      bankName: detail.bank.name,
      mode,
      typeFilter: mode === 'BY_TYPE' ? typeFilter : null,
      questions: finalQuestions,
    })
  }

  if (!activeBankId) {
    return (
      <section className="flex flex-col items-center gap-4 px-6 pb-28 pt-24 text-center">
        <p className="text-sm text-stone-500 dark:text-zinc-400">尚未选择题库</p>
        <Button className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setView('banks')}>
          返回题库列表
        </Button>
      </section>
    )
  }

  const bank = detail?.bank

  return (
    <section aria-label="复习设置" className="animate-in fade-in pb-32 duration-300">
      {/* 吸顶子页面导航栏 */}
      <div className="safe-top sticky top-0 z-30 border-b border-stone-200/80 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex h-14 items-center gap-1 px-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            onClick={() => setView('banks')}
            aria-label="返回题库列表"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{bank?.name || activeBankName}</p>
            <p className="text-[11px] text-stone-400 dark:text-zinc-500">选择模式，开始复习</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[76px] rounded-2xl" />
            ))}
          </div>
        )}

        {!loading && questions.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 px-6 py-12 text-center dark:border-zinc-700">
            <CircleAlert className="size-10 text-stone-300 dark:text-zinc-600" />
            <p className="text-sm text-stone-500 dark:text-zinc-400">该题库还没有题目，先去导入或添加题目吧</p>
            <Button variant="outline" className="h-11" onClick={() => setView('banks')}>
              返回题库
            </Button>
          </div>
        )}

        {!loading && questions.length > 0 && (
          <div className="space-y-5">
            {/* 题库概览 chips */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '总题数', value: bank?.total ?? questions.length },
                { label: '已掌握', value: bank?.known ?? 0 },
                { label: '错题', value: bank?.wrong ?? 0 },
                { label: '收藏', value: bank?.starred ?? 0 },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-xl border border-stone-200/80 bg-white px-2 py-2 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="text-base font-bold tabular-nums">{value}</p>
                  <p className="text-[10px] text-stone-500 dark:text-zinc-400">{label}</p>
                </div>
              ))}
            </div>

            {/* 模式列表 */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-stone-700 dark:text-zinc-200">复习模式</h3>
              <div className="space-y-2.5">
                {MODE_META.map(({ mode: m, icon: Icon, tone }) => {
                  const count = poolOf(m, m === 'BY_TYPE' ? typeFilter : null).length
                  const disabled = count === 0
                  const selected = mode === m
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMode(m)}
                      aria-pressed={selected}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all active:scale-[0.99]',
                        selected
                          ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/25 dark:border-emerald-600 dark:bg-emerald-950/40'
                          : 'border-stone-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900',
                        disabled && 'opacity-45',
                      )}
                    >
                      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', tone)}>
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-stone-800 dark:text-zinc-100">
                          {REVIEW_MODE_LABEL[m]}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-stone-500 dark:text-zinc-400">
                          {REVIEW_MODE_DESC[m]}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-center gap-1">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            selected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-stone-100 text-stone-500 dark:bg-zinc-800 dark:text-zinc-400',
                          )}
                        >
                          {count} 题
                        </span>
                        <span
                          className={cn(
                            'size-4 rounded-full border-2 transition-colors',
                            selected ? 'border-emerald-600 bg-emerald-600' : 'border-stone-300 dark:border-zinc-600',
                          )}
                          aria-hidden
                        >
                          {selected && <span className="block size-full scale-50 rounded-full bg-white" />}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 单项复习：题型 chips */}
            {mode === 'BY_TYPE' && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-stone-700 dark:text-zinc-200">选择题型</h3>
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {QUESTION_TYPE_ORDER.filter((t) => (typeCounts.get(t) || 0) > 0).map((t) => {
                    const selected = typeFilter === t
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTypeFilter(t)}
                        aria-pressed={selected}
                        className={cn(
                          'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors',
                          selected
                            ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                            : 'border-stone-300 bg-white text-stone-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
                        )}
                      >
                        {QUESTION_TYPE_LABEL[t]}
                        <span className={cn('text-xs', selected ? 'text-white/80' : 'text-stone-400')}>
                          {typeCounts.get(t)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 数量 */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-stone-700 dark:text-zinc-200">本次数量</h3>
              <div className="grid grid-cols-5 gap-2">
                {LIMIT_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setLimit(v)}
                    aria-pressed={limit === v}
                    className={cn(
                      'h-11 rounded-xl border text-sm font-medium transition-colors',
                      limit === v
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                        : 'border-stone-200/80 bg-white text-stone-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
                    )}
                  >
                    {v === 'ALL' ? '全部' : v}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-400 dark:text-zinc-500">
                将复习 {finalQuestions.length} 题
                {(mode === 'SHUFFLE' || mode === 'SMART') && '（已随机打乱）'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 吸底开始栏 */}
      {!loading && questions.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <Button
            className="h-12 w-full bg-emerald-600 text-base font-semibold text-white shadow-md hover:bg-emerald-700"
            onClick={handleStart}
            disabled={finalQuestions.length === 0 || (mode === 'BY_TYPE' && !typeFilter)}
          >
            <PlayCircle className="size-5" />
            开始复习（{finalQuestions.length} 题）
          </Button>
        </div>
      )}
    </section>
  )
}
