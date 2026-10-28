'use client'

import { useEffect, useRef } from 'react'
import { Bot, CircleStop, FileSearch, ListChecks, ScanText, Sparkles } from 'lucide-react'
import type { AiStreamEvent } from '@/lib/api-client'
import { QUESTION_TYPE_LABEL, type ParsedQuestion, type QuestionType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

export interface AiStreamState {
  phase: { percent: number; message: string }
  meta: {
    chunkTotal: number
    chunkDone: number
    hasAnswerKey: boolean
    chars: number
    sections: { title: string; type: string; chunkCount: number }[]
  } | null
  live: ParsedQuestion[]
  notes: string[]
  elapsed: number
}

interface AiStreamPanelProps {
  state: AiStreamState
  onCancel: () => void
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m} 分 ${r} 秒` : `${r} 秒`
}

/**
 * AI 识别 Agent 运行面板（流式进度 + 实时题目流）。
 * 桌面导入向导与移动端导入共用。
 */
export function AiStreamPanel({ state, onCancel }: AiStreamPanelProps) {
  const { phase, meta, live, notes, elapsed } = state
  const feedRef = useRef<HTMLDivElement>(null)

  // 新题目到达时自动滚动到最新（仅滚动，不 setState）
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [live.length])

  const typeStats = (
    Object.entries(
      live.reduce<Record<string, number>>((acc, q) => {
        acc[q.type] = (acc[q.type] || 0) + 1
        return acc
      }, {}),
    ) as [QuestionType, number][]
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="gap-4 py-5">
        <CardContent className="space-y-4 px-5">
          {/* 标题行 */}
          <div className="flex items-center gap-3">
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <Bot className="size-5" />
              <span className="absolute -right-0.5 -top-0.5 flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold sm:text-base">AI 识别 Agent 运行中</p>
              <p className="text-xs text-stone-400 dark:text-zinc-500" aria-live="polite">
                已运行 {formatElapsed(elapsed)} · 请保持页面打开
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-stone-300 text-stone-500 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400"
              onClick={onCancel}
            >
              <CircleStop className="size-4" />
              取消
            </Button>
          </div>

          {/* 进度条 */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-stone-700 dark:text-zinc-200" aria-live="polite">
                {phase.message}
              </p>
              <span className="shrink-0 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {phase.percent}%
              </span>
            </div>
            <Progress value={phase.percent} className="h-2.5" aria-label="识别进度" />
          </div>

          {/* 结构信息 */}
          {meta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <ScanText className="size-3.5" />
                {meta.chars} 字
              </span>
              <span className="inline-flex items-center gap-1">
                <FileSearch className="size-3.5" />
                {meta.sections.length} 个章节 · 共 {meta.chunkTotal} 段
              </span>
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3.5" />
                {meta.hasAnswerKey ? '已定位答案表，将自动匹配' : '未检测到答案表'}
              </span>
            </div>
          )}

          {/* 实时统计 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
            <Sparkles className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm text-stone-600 dark:text-zinc-300">
              已识别
              <span className="mx-1.5 inline-block text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {live.length}
              </span>
              道题
            </span>
            {typeStats.length > 0 && (
              <div className="ml-auto flex max-w-full flex-wrap gap-1.5">
                {typeStats.map(([type, count]) => (
                  <QuestionTypeBadge key={type} type={type} className="text-[11px]">
                    {`${QUESTION_TYPE_LABEL[type]} ×${count}`}
                  </QuestionTypeBadge>
                ))}
              </div>
            )}
          </div>

          {/* 警告 */}
          {notes.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
              {notes.slice(-3).map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}

          {/* 实时题目流 */}
          {live.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-stone-400 dark:text-zinc-500">实时识别结果</p>
              <div
                ref={feedRef}
                className="custom-scrollbar max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-stone-200 p-2 dark:border-zinc-800"
              >
                {live.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-stone-50 px-2.5 py-2 text-xs dark:bg-zinc-900"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-stone-400 shadow-sm dark:bg-zinc-800 dark:text-zinc-500">
                      {i + 1}
                    </span>
                    <span className="shrink-0 pt-px">
                      <QuestionTypeBadge type={q.type} className="text-[10px]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-zinc-300">{q.stem}</span>
                    {q.answer && (
                      <span className="max-w-24 shrink-0 truncate font-medium text-emerald-600 dark:text-emerald-400">
                        {q.answer}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-[11px] leading-relaxed text-stone-400 dark:text-zinc-600">
            Agent 正在多路并行识别、自动匹配文末答案，通常 1 分钟内完成
            <br />
            请保持页面在前台：手机锁屏或切到后台可能中断连接（中断后重新识别会秒级恢复）
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
