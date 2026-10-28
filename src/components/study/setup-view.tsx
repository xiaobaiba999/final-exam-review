'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const LIMIT_OPTIONS = [
  { value: 'ALL', label: '全部' },
  { value: '10', label: '10 题' },
  { value: '20', label: '20 题' },
  { value: '30', label: '30 题' },
  { value: '50', label: '50 题' },
] as const

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function SetupView() {
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

  const load = useCallback(async () => {
    if (!activeBankId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const d = await getBank(activeBankId)
      setDetail(d)
      setError(null)
      // 默认选中第一个有题量的题型
      const firstType = QUESTION_TYPE_ORDER.find((t) => d.questions.some((q) => q.type === t))
      setTypeFilter(firstType ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载题库失败')
    } finally {
      setLoading(false)
    }
  }, [activeBankId])

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
          // 默认选中第一个有题量的题型
          const firstType = QUESTION_TYPE_ORDER.find((t) => d.questions.some((qq) => qq.type === t))
          if (!cancelled) setTypeFilter(firstType ?? null)
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

  /** 各模式的候选题池 */
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
      <section className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-stone-500 dark:text-zinc-400">尚未选择题库</p>
        <Button
          className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => setView('banks')}
        >
          返回题库列表
        </Button>
      </section>
    )
  }

  const bank = detail?.bank

  return (
    <section aria-label="复习设置" className="animate-in fade-in duration-300">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">{bank?.name || activeBankName}</h2>
        {bank && (
          <p className="mt-1 text-sm text-stone-500 dark:text-zinc-400">
            共 {bank.total} 题 · 已掌握 {bank.known} · 错题 {bank.wrong} · 收藏 {bank.starred}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && questions.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 px-6 py-14 text-center dark:border-zinc-700">
          <CircleAlert className="size-10 text-stone-300 dark:text-zinc-600" />
          <p className="text-sm text-stone-500 dark:text-zinc-400">该题库还没有题目，先去浏览页添加或导入新题库吧</p>
          <Button variant="outline" className="h-11" onClick={() => setView('browse')}>
            查看题库
          </Button>
        </div>
      )}

      {!loading && questions.length > 0 && (
        <div className="space-y-6">
          {/* 模式选择 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
                    selected
                      ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/30 dark:border-emerald-600 dark:bg-emerald-950/40'
                      : 'border-stone-200 bg-white hover:border-emerald-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-800',
                    disabled && 'cursor-not-allowed opacity-50 hover:shadow-none',
                  )}
                >
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', tone)}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-stone-800 dark:text-zinc-100">
                        {REVIEW_MODE_LABEL[m]}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          selected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-stone-100 text-stone-500 dark:bg-zinc-800 dark:text-zinc-400',
                        )}
                      >
                        {count} 题可用
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-stone-500 dark:text-zinc-400">
                      {REVIEW_MODE_DESC[m]}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* 单项复习：题型 chips */}
          {mode === 'BY_TYPE' && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-stone-600 dark:text-zinc-300">选择题型</h3>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPE_ORDER.filter((t) => (typeCounts.get(t) || 0) > 0).map((t) => {
                  const selected = typeFilter === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      aria-pressed={selected}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors',
                        selected
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                          : 'border-stone-300 bg-white text-stone-600 hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-emerald-700',
                      )}
                    >
                      {QUESTION_TYPE_LABEL[t]}
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-xs',
                          selected ? 'bg-white/20' : 'bg-stone-100 text-stone-400 dark:bg-zinc-800 dark:text-zinc-500',
                        )}
                      >
                        {typeCounts.get(t)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 数量限制 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-stone-600 dark:text-zinc-300">本次数量</span>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger className="h-11 w-32" aria-label="选择本次复习题数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-stone-400 dark:text-zinc-500">
              将复习 {finalQuestions.length} 题
              {(mode === 'SHUFFLE' || mode === 'SMART') && '（已随机打乱）'}
            </span>
          </div>

          {/* 开始按钮 */}
          <div className="flex justify-center border-t border-stone-200 pt-6 dark:border-zinc-800">
            <Button
              size="lg"
              className="h-12 w-full max-w-xs bg-emerald-600 text-base text-white shadow-md hover:bg-emerald-700"
              onClick={handleStart}
              disabled={finalQuestions.length === 0 || (mode === 'BY_TYPE' && !typeFilter)}
            >
              <PlayCircle className="size-5" />
              开始复习（{finalQuestions.length} 题）
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
