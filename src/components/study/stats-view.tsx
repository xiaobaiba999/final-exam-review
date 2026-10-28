'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** 题型条形图配色（呼应 QUESTION_TYPE_BADGE 的底色思路，使用 500 色阶实心条） */
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

export function StatsView() {
  const banksVersion = useAppStore((s) => s.banksVersion)
  const setView = useAppStore((s) => s.setView)

  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getStats()
      setStats(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载统计数据失败')
    }
  }, [])

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
        { label: '总题数', value: String(stats.totals.questions), icon: BookOpen, tone: 'text-stone-600 dark:text-zinc-300' },
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
    <section aria-label="学习统计" className="animate-in fade-in duration-300">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">学习统计</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-zinc-400">纵览所有题库的复习进度与掌握情况</p>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-center gap-3 px-4 text-sm text-red-700 dark:text-red-300">
            <span className="flex-1">{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 加载骨架 */}
      {!stats && !error && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      {stats && stats.totals.questions === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <BarChart3 className="size-8" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">暂无学习数据</h3>
            <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-zinc-400">
              先导入一个题库，复习几次后这里会展示你的掌握进度
            </p>
          </div>
          <Button
            size="lg"
            className="mt-2 h-12 bg-emerald-600 px-8 text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setView('import')}
          >
            <FilePlus2 className="size-5" />
            导入题库
          </Button>
        </div>
      )}

      {stats && stats.totals.questions > 0 && (
        <div className="space-y-6">
          {/* 指标卡 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map(({ label, value, icon: Icon, tone }) => (
              <Card key={label} className="gap-0 py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 dark:bg-zinc-800', tone)}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xl font-bold leading-tight tabular-nums">{value}</span>
                    <span className="block text-xs text-stone-500 dark:text-zinc-400">{label}</span>
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 总掌握进度 */}
          <Card className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-base">总体掌握进度</CardTitle>
              <CardDescription>
                已掌握 {stats.totals.known} / {stats.totals.questions} 题（{Math.round(stats.totals.masteredRate)}%）
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <Progress
                value={stats.totals.masteredRate}
                className="h-3 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
                aria-label={`总体掌握进度 ${Math.round(stats.totals.masteredRate)}%`}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* 各题库进度 */}
            <Card className="gap-4 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-base">各题库进度</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-5">
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
              </CardContent>
            </Card>

            {/* 题型分布 */}
            <Card className="gap-4 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-base">题型分布</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5">
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
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}
