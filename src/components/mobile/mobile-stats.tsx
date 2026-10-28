'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  Target,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { getStats, type GlobalStats } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** 题型条形图配色（与桌面统计页一致） */
const BAR_COLORS: Record<string, string> = {
  SINGLE: 'bg-emerald-500',
  MULTIPLE: 'bg-amber-500',
  TRUE_FALSE: 'bg-rose-500',
  FILL_BLANK: 'bg-cyan-500',
  TERM: 'bg-violet-500',
  SHORT_ANSWER: 'bg-stone-500',
  ESSAY: 'bg-orange-500',
  CALCULATION: 'bg-lime-500',
  CASE: 'bg-teal-500',
  OTHER: 'bg-zinc-400',
}

/** 移动端学习统计：单列紧凑布局 */
export function MobileStats() {
  const banksVersion = useAppStore((s) => s.banksVersion)
  const setView = useAppStore((s) => s.setView)

  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await getStats()
        if (!cancelled) {
          setStats(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载统计数据失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [banksVersion])

  const metrics = stats
    ? [
        { label: '总题数', value: String(stats.totals.questions), icon: BookOpen, tone: 'text-stone-700 dark:text-zinc-200' },
        { label: '已掌握', value: String(stats.totals.known), icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
        { label: '错题待巩固', value: String(stats.totals.wrong), icon: CircleAlert, tone: 'text-amber-600 dark:text-amber-400' },
        { label: '累计正确率', value: `${Math.round(stats.totals.accuracy)}%`, icon: Target, tone: 'text-teal-600 dark:text-teal-400' },
      ]
    : []

  const typeEntries = stats
    ? Object.entries(stats.typeCounts)
        .map(([type, count]) => ({ type, count: count || 0, label: stats.typeLabels[type] || type }))
        .filter((e) => e.count > 0)
        .sort((a, b) => b.count - a.count)
    : []
  const maxTypeCount = typeEntries.length > 0 ? typeEntries[0].count : 0

  return (
    <section aria-label="学习统计" className="animate-in fade-in px-4 pb-28 pt-4 duration-300">
      <div className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">学习统计</h2>
        <p className="mt-0.5 text-xs text-stone-500 dark:text-zinc-400">
          纵览所有题库的复习进度与掌握情况
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 加载骨架 */}
      {!stats && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )}

      {/* 空状态 */}
      {stats && stats.totals.questions === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-stone-300 bg-white/70 px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <BarChart3 className="size-8" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">暂无学习数据</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-zinc-400">
              先导入一个题库，复习几次后这里会展示你的掌握进度
            </p>
          </div>
          <Button
            size="lg"
            className="mt-1 h-12 bg-emerald-600 px-8 text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setView('import')}
          >
            <FilePlus2 className="size-5" />
            导入题库
          </Button>
        </div>
      )}

      {stats && stats.totals.questions > 0 && (
        <div className="space-y-4">
          {/* 指标卡 */}
          <div className="grid grid-cols-2 gap-2.5">
            {metrics.map(({ label, value, icon: Icon, tone }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-xl border border-stone-200/80 bg-white px-3 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Icon className={cn('size-5 shrink-0', tone)} />
                <span className="min-w-0">
                  <span className="block text-lg font-bold leading-tight tabular-nums">{value}</span>
                  <span className="block text-[11px] text-stone-500 dark:text-zinc-400">{label}</span>
                </span>
              </div>
            ))}
          </div>

          {/* 总掌握进度 */}
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-semibold text-stone-800 dark:text-zinc-100">总体掌握进度</p>
            <p className="mb-2.5 mt-0.5 text-xs text-stone-500 dark:text-zinc-400">
              已掌握 {stats.totals.known} / {stats.totals.questions} 题（{Math.round(stats.totals.masteredRate)}%）
            </p>
            <Progress
              value={stats.totals.masteredRate}
              className="h-3 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
              aria-label={`总体掌握进度 ${Math.round(stats.totals.masteredRate)}%`}
            />
          </div>

          {/* 各题库进度 */}
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-3 text-sm font-semibold text-stone-800 dark:text-zinc-100">各题库进度</p>
            <div className="space-y-3.5">
              {stats.banks.length === 0 && (
                <p className="text-sm text-stone-500 dark:text-zinc-400">还没有题库</p>
              )}
              {stats.banks.map((b) => (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-stone-700 dark:text-zinc-200">{b.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-zinc-400">
                      {b.known}/{b.total} · {Math.round(b.masteredRate)}%
                    </span>
                  </div>
                  <Progress
                    value={b.masteredRate}
                    className="h-2 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
                    aria-label={`题库「${b.name}」掌握率 ${Math.round(b.masteredRate)}%`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 题型分布 */}
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-3 text-sm font-semibold text-stone-800 dark:text-zinc-100">题型分布</p>
            <div className="space-y-2.5">
              {typeEntries.length === 0 && (
                <p className="text-sm text-stone-500 dark:text-zinc-400">暂无数据</p>
              )}
              {typeEntries.map(({ type, count, label }) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-right text-xs text-stone-500 dark:text-zinc-400">{label}</span>
                  <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-zinc-800">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', BAR_COLORS[type] || 'bg-zinc-400')}
                      style={{ width: `${Math.max((count / maxTypeCount) * 100, 4)}%` }}
                      role="img"
                      aria-label={`${label} ${count} 题`}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-xs tabular-nums text-stone-500 dark:text-zinc-400">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
