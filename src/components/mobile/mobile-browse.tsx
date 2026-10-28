'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  PencilLine,
  PlayCircle,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import {
  deleteQuestion,
  generateExplanation,
  generateExplanationsBatch,
  getBank,
  updateQuestion,
  type BankDetail,
} from '@/lib/api-client'
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  normalizeChoiceAnswer,
  normalizeTrueFalse,
  type QuestionRecord,
  type QuestionStatus,
  type QuestionType,
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QuestionEditDialog, type EditableQuestion } from '@/components/study/question-edit-dialog'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

type TypeFilter = 'ALL' | QuestionType
type StatusFilter = 'ALL' | QuestionStatus

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'new', label: '未学' },
  { value: 'known', label: '已掌握' },
  { value: 'wrong', label: '答错' },
]

const STATUS_DOT: Record<QuestionStatus, string> = {
  new: 'bg-stone-300 dark:bg-zinc-600',
  known: 'bg-emerald-500',
  wrong: 'bg-red-500',
}

/** 移动端题目浏览：吸顶返回栏 + 筛选 chips + 展开式题卡（答案/解析/AI 生成） */
export function MobileBrowse() {
  const activeBankId = useAppStore((s) => s.activeBankId)
  const activeBankName = useAppStore((s) => s.activeBankName)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const setView = useAppStore((s) => s.setView)
  const refreshBanks = useAppStore((s) => s.refreshBanks)

  const [detail, setDetail] = useState<BankDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<QuestionRecord | null>(null)
  const [deleting, setDeleting] = useState<QuestionRecord | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [aiSingleId, setAiSingleId] = useState<string | null>(null)
  const [aiBatchRunning, setAiBatchRunning] = useState(false)
  const [aiBatchDone, setAiBatchDone] = useState(0)
  const [aiBatchTotal, setAiBatchTotal] = useState(0)

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

  const questions = detail?.questions || []

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const q of questions) map.set(q.type, (map.get(q.type) || 0) + 1)
    return map
  }, [questions])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return questions.filter((q) => {
      if (typeFilter !== 'ALL' && q.type !== typeFilter) return false
      if (statusFilter !== 'ALL' && q.status !== statusFilter) return false
      if (kw && !q.stem.toLowerCase().includes(kw) && !(q.answer || '').toLowerCase().includes(kw)) return false
      return true
    })
  }, [questions, typeFilter, statusFilter, search])

  const missingExplanation = useMemo(
    () => questions.filter((q) => !q.explanation).length,
    [questions],
  )

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStar = async (q: QuestionRecord) => {
    const next = !q.starred
    setDetail((d) =>
      d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, starred: next } : x)) } : d,
    )
    try {
      await updateQuestion(q.id, { starred: next })
    } catch (e) {
      setDetail((d) =>
        d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, starred: !next } : x)) } : d,
      )
      toast({
        title: '收藏失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }

  const handleSingleGenerate = async (q: QuestionRecord) => {
    if (aiSingleId) return
    setAiSingleId(q.id)
    try {
      const { explanation } = await generateExplanation(q.id)
      setDetail((d) =>
        d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? { ...x, explanation } : x)) } : d,
      )
      toast({ title: 'AI 解析已生成' })
    } catch (e) {
      toast({
        title: '生成失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setAiSingleId(null)
    }
  }

  /** 批量补全解析：每轮 4 题，循环直到补完（防 502 的分批策略） */
  const handleBatchGenerate = async () => {
    if (aiBatchRunning || !activeBankId) return
    const total = questions.filter((q) => !q.explanation).length
    if (total === 0) return
    setAiBatchRunning(true)
    setAiBatchTotal(total)
    setAiBatchDone(0)
    try {
      for (;;) {
        const r = await generateExplanationsBatch(activeBankId, 4)
        setAiBatchDone((v) => v + r.generated)
        if (r.remaining === 0 || r.generated === 0) break
      }
      const d = await getBank(activeBankId)
      setDetail(d)
      toast({ title: '全部解析已生成', description: '本次共补全，复习时自动展示' })
    } catch (e) {
      toast({
        title: '批量生成中断',
        description: e instanceof Error ? e.message : '已完成部分，可再次点击继续',
        variant: 'destructive',
      })
      if (activeBankId) {
        try {
          const d = await getBank(activeBankId)
          setDetail(d)
        } catch {
          /* 忽略刷新失败 */
        }
      }
    } finally {
      setAiBatchRunning(false)
      setAiBatchDone(0)
      setAiBatchTotal(0)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteSaving(true)
    try {
      await deleteQuestion(deleting.id)
      setDetail((d) => (d ? { ...d, questions: d.questions.filter((x) => x.id !== deleting.id) } : d))
      toast({ title: '题目已删除' })
      setDeleting(null)
      refreshBanks()
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setDeleteSaving(false)
    }
  }

  const handleEditSave = async (data: EditableQuestion) => {
    if (!editing) return
    await updateQuestion(editing.id, {
      type: data.type,
      stem: data.stem,
      options: data.options,
      answer: data.answer,
      explanation: data.explanation || null,
    })
    setDetail((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((x) =>
              x.id === editing.id ? { ...x, ...data, explanation: data.explanation || null } : x,
            ),
          }
        : d,
    )
    setEditing(null)
    refreshBanks()
    toast({ title: '题目已更新' })
  }

  // 无题库上下文
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
    <section aria-label="题目浏览" className="animate-in fade-in pb-16 duration-300">
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
            {bank && (
              <p className="truncate text-[11px] text-stone-400 dark:text-zinc-500">
                共 {bank.total} 题 · 已掌握 {bank.known} · 错题 {bank.wrong}
              </p>
            )}
          </div>
          <Button
            size="icon"
            className="size-10 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => setView('setup')}
            aria-label="进入复习设置"
          >
            <PlayCircle className="size-5" />
          </Button>
        </div>
      </div>

      {/* 筛选区 */}
      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索题干或答案关键词"
            className="h-10 pl-9"
            aria-label="搜索题目"
          />
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTypeFilter('ALL')}
            aria-pressed={typeFilter === 'ALL'}
            className={cn(
              'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors',
              typeFilter === 'ALL'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-stone-300 bg-white text-stone-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
            )}
          >
            全部 {questions.length > 0 && `· ${questions.length}`}
          </button>
          {QUESTION_TYPE_ORDER.filter((t) => (typeCounts.get(t) || 0) > 0).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              aria-pressed={typeFilter === t}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3.5 text-xs font-medium transition-colors',
                typeFilter === t
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-stone-300 bg-white text-stone-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
              )}
            >
              {QUESTION_TYPE_LABEL[t]}
              <span className={cn('text-[10px]', typeFilter === t ? 'text-white/80' : 'text-stone-400')}>
                {typeCounts.get(t)}
              </span>
            </button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {STATUS_CHIPS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={cn(
                'inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[11px] font-medium transition-colors',
                statusFilter === value
                  ? 'border-stone-700 bg-stone-700 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900'
                  : 'border-stone-200 bg-white text-stone-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 批量 AI 解析横幅 */}
      {missingExplanation > 0 && !loading && (
        <div className="mx-4 mb-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-3.5 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex items-center gap-2.5">
            <Sparkles className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="min-w-0 flex-1 text-xs text-stone-600 dark:text-zinc-300">
              {missingExplanation} 题还没有详细解析
            </p>
            <Button
              size="sm"
              className="h-9 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
              onClick={() => void handleBatchGenerate()}
              disabled={aiBatchRunning}
            >
              {aiBatchRunning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  生成中
                </>
              ) : (
                '一键补全'
              )}
            </Button>
          </div>
          {aiBatchRunning && aiBatchTotal > 0 && (
            <div className="mt-2.5" role="status" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-emerald-200/60 dark:bg-emerald-900/60">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((aiBatchDone / aiBatchTotal) * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-right text-[11px] tabular-nums text-emerald-700 dark:text-emerald-400">
                {Math.min(aiBatchDone, aiBatchTotal)}/{aiBatchTotal}
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2.5 px-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="mx-4 rounded-2xl border-2 border-dashed border-stone-300 px-6 py-10 text-center dark:border-zinc-700">
          <BookOpen className="mx-auto size-8 text-stone-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400">
            {questions.length === 0 ? '该题库还没有题目' : '没有符合筛选条件的题目'}
          </p>
        </div>
      )}

      {/* 题目卡列表 */}
      {!loading && filtered.length > 0 && (
        <ul className="space-y-2.5 px-4">
          {filtered.map((q, idx) => {
            const expanded = expandedIds.has(q.id)
            const revealed = revealedIds.has(q.id)
            const correctKeys = normalizeChoiceAnswer(q.answer)
            return (
              <li
                key={q.id}
                className="rounded-2xl border border-stone-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* 折叠头 */}
                <button
                  type="button"
                  className="flex w-full items-start gap-2.5 p-3.5 text-left"
                  onClick={() => toggleExpand(q.id)}
                  aria-expanded={expanded}
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-semibold tabular-nums text-stone-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <QuestionTypeBadge type={q.type} className="text-[10px]">
                        {QUESTION_TYPE_LABEL[q.type]}
                      </QuestionTypeBadge>
                      <span className={cn('size-1.5 rounded-full', STATUS_DOT[q.status])} aria-label={
                        q.status === 'known' ? '已掌握' : q.status === 'wrong' ? '曾答错' : '未学'
                      } />
                      {q.starred && <Star className="size-3 fill-amber-400 text-amber-400" />}
                    </span>
                    <span className={cn('mt-1 block text-sm leading-relaxed text-stone-800 dark:text-zinc-100', !expanded && 'line-clamp-2')}>
                      {q.stem}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn('mt-1 size-4 shrink-0 text-stone-400 transition-transform', expanded && 'rotate-180')}
                  />
                </button>

                {/* 展开内容 */}
                {expanded && (
                  <div className="space-y-3 border-t border-stone-100 px-3.5 pb-3.5 pt-3 dark:border-zinc-800/80">
                    {/* 选项（只读） */}
                    {q.options.length > 0 && (
                      <div className="space-y-1.5">
                        {q.options.map((o) => (
                          <div
                            key={o.label}
                            className={cn(
                              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                              revealed && correctKeys.includes(o.label)
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                                : 'border-stone-200/70 text-stone-600 dark:border-zinc-800 dark:text-zinc-300',
                            )}
                          >
                            <span className="font-semibold">{o.label}.</span>
                            <span className="min-w-0 flex-1">{o.text}</span>
                            {revealed && correctKeys.includes(o.label) && (
                              <Check className="size-4 shrink-0 text-emerald-600" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 答案 */}
                    {revealed ? (
                      <div className="rounded-xl bg-stone-50 p-3 dark:bg-zinc-800/60">
                        <p className="mb-1 text-[11px] text-stone-400 dark:text-zinc-500">参考答案</p>
                        {q.type === 'TRUE_FALSE' ? (
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            {normalizeTrueFalse(q.answer) === '对' ? '正确' : '错误'}
                          </p>
                        ) : q.type === 'SINGLE' || q.type === 'MULTIPLE' ? (
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            {correctKeys.join('、') || q.answer || '（未识别到答案）'}
                          </p>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm font-medium text-emerald-700 dark:text-emerald-300">
                            {q.answer || '（未识别到答案）'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="h-10 w-full border-stone-300 text-stone-600 dark:border-zinc-700 dark:text-zinc-300"
                        onClick={() => toggleReveal(q.id)}
                      >
                        <Eye className="size-4" />
                        显示答案
                      </Button>
                    )}

                    {/* 解析 */}
                    {revealed && q.explanation && (
                      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-stone-50/60 p-3 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-zinc-800/40">
                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <BookOpen className="size-3" />
                          题目解析
                        </p>
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-stone-700 dark:text-zinc-300">
                          {q.explanation}
                        </p>
                      </div>
                    )}
                    {revealed && !q.explanation && (
                      <Button
                        variant="outline"
                        className="h-10 w-full border-dashed border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                        onClick={() => void handleSingleGenerate(q)}
                        disabled={aiSingleId === q.id}
                      >
                        {aiSingleId === q.id ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            AI 生成中…
                          </>
                        ) : (
                          <>
                            <Sparkles className="size-4" />
                            AI 生成详细解析
                          </>
                        )}
                      </Button>
                    )}

                    {/* 操作行 */}
                    <div className="flex items-center gap-1 pt-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2.5 text-xs text-stone-500 dark:text-zinc-400"
                        onClick={() => void toggleStar(q)}
                        aria-pressed={q.starred}
                      >
                        <Star className={cn('size-4', q.starred && 'fill-amber-400 text-amber-400')} />
                        {q.starred ? '已收藏' : '收藏'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2.5 text-xs text-stone-500 dark:text-zinc-400"
                        onClick={() => setEditing(q)}
                      >
                        <PencilLine className="size-4" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2.5 text-xs text-stone-500 hover:text-red-600 dark:text-zinc-400"
                        onClick={() => setDeleting(q)}
                      >
                        <Trash2 className="size-4" />
                        删除
                      </Button>
                      {revealed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-9 px-2.5 text-xs text-stone-400"
                          onClick={() => toggleReveal(q.id)}
                        >
                          <EyeOff className="size-4" />
                          隐藏答案
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* 编辑对话框 */}
      <QuestionEditDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title="编辑题目"
        initial={
          editing
            ? {
                type: editing.type,
                stem: editing.stem,
                options: editing.options,
                answer: editing.answer,
                explanation: editing.explanation ?? '',
              }
            : null
        }
        onSave={handleEditSave}
      />

      {/* 删除确认 */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这道题？</AlertDialogTitle>
            <AlertDialogDescription className="line-clamp-3">
              {deleting?.stem.slice(0, 60) || '该题目将被永久删除，此操作不可撤销。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteSaving}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
