'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  PlayCircle,
  Search,
  Sparkles,
  Star,
  Trash2,
  PencilLine,
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
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QuestionEditDialog, type EditableQuestion } from '@/components/study/question-edit-dialog'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

type TypeFilter = 'ALL' | QuestionType
type StatusFilter = 'ALL' | QuestionStatus

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: '全部状态' },
  { value: 'new', label: '未学' },
  { value: 'known', label: '已掌握' },
  { value: 'wrong', label: '答错' },
]

export function BrowseView() {
  const activeBankId = useAppStore((s) => s.activeBankId)
  const activeBankName = useAppStore((s) => s.activeBankName)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const setView = useAppStore((s) => s.setView)
  const refreshBanks = useAppStore((s) => s.refreshBanks)
  const bumpDataVersion = useAppStore((s) => s.bumpDataVersion)

  const [detail, setDetail] = useState<BankDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<QuestionRecord | null>(null)
  const [deleting, setDeleting] = useState<QuestionRecord | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  /** 解析展开状态（题干列表中查看/收起解析） */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  /** 单题 AI 解析生成中 */
  const [aiSingleId, setAiSingleId] = useState<string | null>(null)
  /** 批量 AI 解析生成中 + 进度 */
  const [aiBatchRunning, setAiBatchRunning] = useState(false)
  const [aiBatchProgress, setAiBatchProgress] = useState<{ done: number; total: number } | null>(null)

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

  /** 缺解析的题数（用于批量补全入口） */
  const missingExplanation = useMemo(
    () => questions.filter((q) => !q.explanation).length,
    [questions],
  )

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 单题 AI 生成解析（成功后乐观写入列表并展开） */
  const handleSingleGenerate = async (q: QuestionRecord) => {
    if (aiSingleId) return
    setAiSingleId(q.id)
    try {
      const { explanation } = await generateExplanation(q.id)
      setDetail((d) =>
        d
          ? {
              ...d,
              questions: d.questions.map((x) =>
                x.id === q.id ? { ...x, explanation } : x,
              ),
            }
          : d,
      )
      setExpandedIds((prev) => new Set(prev).add(q.id))
      toast({ title: 'AI 解析已生成' })
    } catch (e) {
      toast({
        title: 'AI 解析生成失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setAiSingleId(null)
    }
  }

  /** 批量补全：循环调用直到全部生成（每轮 4 题，避免单次请求超时 502） */
  const handleBatchGenerate = async () => {
    if (aiBatchRunning || !activeBankId) return
    setAiBatchRunning(true)
    const total = questions.filter((q) => !q.explanation).length
    setAiBatchProgress({ done: 0, total })
    let failed = 0
    try {
      for (let round = 0; round < 60; round++) {
        const r = await generateExplanationsBatch(activeBankId, 4)
        failed += r.failed
        setAiBatchProgress((p) =>
          p ? { done: Math.min(p.done + r.generated, total), total } : p,
        )
        if (r.remaining === 0) break
        // 本轮全部失败且无产出，终止避免死循环
        if (r.generated === 0 && r.failed >= 4) break
      }
      if (failed > 0) {
        toast({
          title: '部分解析生成失败',
          description: `${failed} 题未能生成，可再次点击“一键补全”重试`,
          variant: 'destructive',
        })
      } else {
        toast({ title: '全部解析已生成', description: '现在每道题都有详细解析了' })
      }
    } catch (e) {
      toast({
        title: '批量生成中断',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setAiBatchRunning(false)
      setAiBatchProgress(null)
      bumpDataVersion()
      refreshBanks()
    }
  }

  const toggleStar = async (q: QuestionRecord) => {
    // 乐观更新
    setDetail((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((x) => (x.id === q.id ? { ...x, starred: !q.starred } : x)),
            bank: { ...d.bank, starred: d.bank.starred + (q.starred ? -1 : 1) },
          }
        : d,
    )
    try {
      await updateQuestion(q.id, { starred: !q.starred })
      refreshBanks()
    } catch (e) {
      // 回滚
      setDetail((d) =>
        d
          ? {
              ...d,
              questions: d.questions.map((x) => (x.id === q.id ? { ...x, starred: q.starred } : x)),
              bank: { ...d.bank, starred: d.bank.starred + (q.starred ? 1 : -1) },
            }
          : d,
      )
      toast({
        title: '收藏失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    }
  }

  const handleEditSave = async (data: EditableQuestion) => {
    if (!editing) return
    try {
      await updateQuestion(editing.id, {
        type: data.type,
        stem: data.stem,
        options: data.options,
        answer: data.answer,
        explanation: data.explanation || null,
      })
      toast({ title: '修改已保存' })
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
      throw e
    }
    bumpDataVersion()
    refreshBanks()
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteSaving(true)
    try {
      await deleteQuestion(deleting.id)
      toast({ title: '题目已删除' })
      setDeleting(null)
      bumpDataVersion()
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

  const bank = detail?.bank
  const pct = bank && bank.total > 0 ? Math.round((bank.known / bank.total) * 100) : 0

  // 无激活题库（如刷新后直接进入）
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

  return (
    <section aria-label={`题库「${activeBankName}」题目浏览`} className="animate-in fade-in duration-300">
      {/* 顶部信息 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="h-11" onClick={() => setView('banks')}>
          <ArrowLeft className="size-4" />
          题库列表
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{bank?.name || activeBankName}</h2>
          <p className="text-xs text-stone-500 dark:text-zinc-400">
            共 {bank?.total ?? '…'} 题 · 已掌握 {bank?.known ?? 0} · 错题 {bank?.wrong ?? 0} · 收藏 {bank?.starred ?? 0}
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Progress
            value={pct}
            className="h-2 w-28 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
            aria-label={`掌握进度 ${pct}%`}
          />
          <span className="w-10 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">{pct}%</span>
          <Button
            className="h-11 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setView('setup')}
            disabled={questions.length === 0}
          >
            <PlayCircle className="size-4" />
            开始复习
          </Button>
        </div>
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

      {/* AI 批量补全解析横幅 */}
      {!loading && missingExplanation > 0 && (
        <div
          className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center dark:border-emerald-900 dark:bg-emerald-950/20"
          aria-label="AI 批量补全解析"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/60">
            <Sparkles className="size-5 text-emerald-600 dark:text-emerald-400" />
          </span>
          <div className="min-w-0 flex-1">
            {aiBatchProgress ? (
              <>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  AI 正在逐题编写解析… {aiBatchProgress.done}/{aiBatchProgress.total}
                </p>
                <Progress
                  value={aiBatchProgress.total > 0 ? (aiBatchProgress.done / aiBatchProgress.total) * 100 : 0}
                  className="mt-2 h-2 bg-emerald-100 dark:bg-emerald-900 [&>div]:bg-emerald-500"
                  aria-label={`解析生成进度 ${aiBatchProgress.done}/${aiBatchProgress.total}`}
                />
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  {missingExplanation} 道题还没有解析
                </p>
                <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/80">
                  让 AI 为每道题编写详细解析：考点 + 答案依据 + 易错提示，复习时随题展示
                </p>
              </>
            )}
          </div>
          <Button
            className="h-11 shrink-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
            disabled={aiBatchRunning}
            onClick={() => void handleBatchGenerate()}
          >
            {aiBatchRunning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {aiBatchRunning ? '生成中…' : '一键补全'}
          </Button>
        </div>
      )}

      {/* 筛选行 */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="按题型筛选">
            <SelectValue placeholder="题型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{`全部题型（${questions.length}）`}</SelectItem>
            {QUESTION_TYPE_ORDER.filter((t) => (typeCounts.get(t) || 0) > 0).map((t) => (
              <SelectItem key={t} value={t}>
                {`${QUESTION_TYPE_LABEL[t]}（${typeCounts.get(t)}）`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-11 w-full sm:w-36" aria-label="按状态筛选">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索题干或答案关键词…"
            aria-label="搜索题目"
            className="h-11 pl-9"
          />
        </div>
      </div>

      {/* 加载骨架 */}
      {loading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="gap-0 py-4">
              <CardContent className="space-y-2 px-4">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 空结果 */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 px-6 py-14 text-center dark:border-zinc-700">
          <CircleAlert className="size-10 text-stone-300 dark:text-zinc-600" />
          <p className="text-sm text-stone-500 dark:text-zinc-400">
            {questions.length === 0 ? '题库中还没有题目' : '没有符合条件的题目'}
          </p>
          {(typeFilter !== 'ALL' || statusFilter !== 'ALL' || search) && (
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              onClick={() => {
                setTypeFilter('ALL')
                setStatusFilter('ALL')
                setSearch('')
              }}
            >
              清除筛选条件
            </Button>
          )}
        </div>
      )}

      {/* 题目列表 */}
      {!loading && filtered.length > 0 && (
        <div className="custom-scrollbar max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {filtered.map((q) => {
            const revealed = revealedIds.has(q.id)
            return (
              <Card key={q.id} className="gap-2 py-3 transition-colors hover:border-emerald-300 dark:hover:border-emerald-800">
                <CardContent className="flex items-start gap-3 px-4">
                  <QuestionTypeBadge type={q.type} className="mt-0.5 shrink-0 text-[11px]" />

                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    onClick={() => void toggleStar(q)}
                    aria-label={q.starred ? `取消收藏：${q.stem.slice(0, 20)}` : `收藏：${q.stem.slice(0, 20)}`}
                    aria-pressed={q.starred}
                  >
                    <Star
                      className={cn(
                        'size-4 transition-colors',
                        q.starred ? 'fill-amber-400 text-amber-400' : 'text-stone-300 dark:text-zinc-600',
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm leading-relaxed text-stone-800 dark:text-zinc-200">
                      {q.stem}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          q.status === 'known' && 'text-emerald-600 dark:text-emerald-400',
                          q.status === 'wrong' && 'text-red-600 dark:text-red-400',
                          q.status === 'new' && 'text-stone-400 dark:text-zinc-500',
                        )}
                      >
                        {q.status === 'known' ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : q.status === 'wrong' ? (
                          <CircleAlert className="size-3.5" />
                        ) : null}
                        {q.status === 'known' ? '已掌握' : q.status === 'wrong' ? '答错过' : '未学'}
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-stone-500 transition-colors hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400"
                        onClick={() => toggleReveal(q.id)}
                        aria-label={revealed ? '隐藏答案' : '查看答案'}
                      >
                        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        答案：
                        {revealed ? (
                          <span className="max-w-64 truncate font-medium text-emerald-700 dark:text-emerald-400">
                            {q.answer || '（空）'}
                          </span>
                        ) : (
                          <span className="tracking-widest">••••••</span>
                        )}
                      </button>
                      {q.wrongCount > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">答错 {q.wrongCount} 次</span>
                      )}
                      {/* 解析入口：有解析可展开/收起，无解析可 AI 生成 */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-stone-500 transition-colors hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400"
                        onClick={() =>
                          q.explanation ? toggleExpand(q.id) : void handleSingleGenerate(q)
                        }
                        disabled={aiSingleId === q.id}
                        aria-label={
                          q.explanation
                            ? expandedIds.has(q.id)
                              ? `收起解析：${q.stem.slice(0, 20)}`
                              : `查看解析：${q.stem.slice(0, 20)}`
                            : `AI 生成解析：${q.stem.slice(0, 20)}`
                        }
                      >
                        {q.explanation ? (
                          <>
                            {expandedIds.has(q.id) ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <BookOpen className="size-3.5" />
                            )}
                            解析
                          </>
                        ) : aiSingleId === q.id ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            AI 生成中…
                          </>
                        ) : (
                          <>
                            <Sparkles className="size-3.5" />
                            AI 生成解析
                          </>
                        )}
                      </button>
                    </div>

                    {/* 解析展开区 */}
                    {q.explanation && expandedIds.has(q.id) && (
                      <div className="mt-2 rounded-lg border border-emerald-200/70 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <BookOpen className="size-3" />
                          题目解析
                        </p>
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-stone-600 dark:text-zinc-300">
                          {q.explanation}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`编辑题目：${q.stem.slice(0, 20)}`}
                      onClick={() => setEditing(q)}
                    >
                      <PencilLine className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-red-600"
                      aria-label={`删除题目：${q.stem.slice(0, 20)}`}
                      onClick={() => setDeleting(q)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
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
                explanation: editing.explanation || '',
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
              {deleting?.stem || ''}
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
