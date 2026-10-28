'use client'

// 题库管理：列表 / 题型与范围（错题本/收藏）筛选 / 搜索 / 星标 / 删除 / AI 补解析
// 数据走共享 store：与其他 Tab 共用缓存，切换页面零等待
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import {
  ChevronDown,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react'
import { deleteQuestion, clearQuestions, runExplain } from '@/lib/api-client'
import { useQuestionStore } from '@/lib/question-store'
import { useUiStore } from '@/lib/ui-store'
import { ExplanationWithAsk } from '@/components/study/ask-ai'
import { TYPE_LABELS, QuestionType } from '@/lib/types'

type Scope = 'all' | 'wrong' | 'starred'

export function QuestionBank({ onGoImport }: { onGoImport: () => void }) {
  const { toast } = useToast()
  const questions = useQuestionStore((s) => s.questions)
  const loading = useQuestionStore((s) => s.loading)
  const loadedOnce = useQuestionStore((s) => s.loadedOnce)
  const loadError = useQuestionStore((s) => s.error)
  const load = useQuestionStore((s) => s.load)
  const applyAction = useQuestionStore((s) => s.applyAction)
  const removeLocal = useQuestionStore((s) => s.removeLocal)
  const resetLocal = useQuestionStore((s) => s.resetLocal)

  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all')
  // 范围筛选存共享 store：复习页统计卡可跨 Tab 跳转并预置筛选
  const scope = useUiStore((s) => s.bankScope)
  const setScope = useUiStore((s) => s.setBankScope)
  const [keyword, setKeyword] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [explaining, setExplaining] = useState(false)
  const [explainRemain, setExplainRemain] = useState<number | null>(null)
  const [starBusyId, setStarBusyId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  // 同步「缺解析」数量（仅在拿到数据后计算，避免闪烁）
  useEffect(() => {
    if (!loadedOnce) return
    setExplainRemain(questions.filter((q) => !q.explanation).length)
  }, [questions, loadedOnce])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return questions.filter((q) => {
      if (typeFilter !== 'all' && q.type !== typeFilter) return false
      if (scope === 'wrong' && !q.wrong) return false
      if (scope === 'starred' && !q.starred) return false
      if (kw && !q.stem.toLowerCase().includes(kw)) return false
      return true
    })
  }, [questions, typeFilter, scope, keyword])

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { all: questions.length }
    for (const q of questions) m[q.type] = (m[q.type] ?? 0) + 1
    return m
  }, [questions])

  const scopeCounts = useMemo(
    () => ({
      wrong: questions.filter((q) => q.wrong).length,
      starred: questions.filter((q) => q.starred).length,
    }),
    [questions]
  )

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStar = useCallback(
    async (id: string, starred: boolean) => {
      setStarBusyId(id)
      try {
        await applyAction(id, starred ? 'unstar' : 'star')
      } catch (e) {
        toast({
          title: '收藏操作失败',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setStarBusyId(null)
      }
    },
    [applyAction, toast]
  )

  const removeWrong = useCallback(
    async (id: string) => {
      try {
        await applyAction(id, 'removeWrong')
        toast({ title: '已移出错题本' })
      } catch (e) {
        toast({
          title: '操作失败',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      }
    },
    [applyAction, toast]
  )

  const removeOne = async (id: string) => {
    try {
      await deleteQuestion(id)
      removeLocal(id)
      toast({ title: '已删除' })
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    }
  }

  const clearAll = async () => {
    try {
      await clearQuestions()
      resetLocal()
      setExplainRemain(0)
      toast({ title: '题库已清空' })
    } catch (e) {
      toast({
        title: '清空失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    }
  }

  const explain = async () => {
    setExplaining(true)
    let done = 0
    try {
      // 循环补全直到没有缺失（每轮最多 8 道，避免请求过久）
      for (let i = 0; i < 12; i++) {
        const r = await runExplain(8)
        done += r.updated
        setExplainRemain(r.remaining)
        if (r.remaining === 0 || r.updated === 0) break
      }
      toast({ title: `已为 ${done} 道题生成解析`, description: '点击题目可查看' })
      await load(true)
    } catch (e) {
      toast({
        title: '解析生成失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setExplaining(false)
    }
  }

  const listLoading = loading && !loadedOnce

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索题干…"
            className="h-11 pl-8"
            aria-label="搜索题干"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void load(true)}
          aria-label="刷新题库"
          className="h-11 w-11 shrink-0"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        {explainRemain !== null && explainRemain > 0 && (
          <Button onClick={() => void explain()} disabled={explaining} className="h-11 shrink-0">
            {explaining ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            )}
            AI 补解析{explainRemain > 0 ? `（缺 ${explainRemain}）` : ''}
          </Button>
        )}
        {questions.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="h-11 shrink-0 text-destructive hover:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                清空
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认清空题库？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除全部 {questions.length} 道题（含错题本与收藏状态），操作不可恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void clearAll()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  确认清空
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* 范围筛选 */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: 'all' as Scope, label: '全部', count: questions.length },
            { key: 'wrong' as Scope, label: '错题本', count: scopeCounts.wrong },
            { key: 'starred' as Scope, label: '收藏', count: scopeCounts.starred },
          ] as const
        ).map(({ key, label, count }) => (
          <Button
            key={key}
            size="sm"
            variant={scope === key ? 'default' : 'outline'}
            onClick={() => setScope(key)}
            className="h-11 px-3.5"
          >
            {label}
            <span className="ml-1 text-xs opacity-70">{count}</span>
          </Button>
        ))}
      </div>

      {/* 类型筛选 */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'single', 'judge', 'blank', 'short'] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={typeFilter === t ? 'default' : 'outline'}
            onClick={() => setTypeFilter(t)}
            className="h-11 px-3.5"
          >
            {t === 'all' ? '全部题型' : TYPE_LABELS[t]}
            <span className="ml-1 text-xs opacity-70">{typeCounts[t] ?? 0}</span>
          </Button>
        ))}
      </div>

      {/* 列表 */}
      {listLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          加载中…
        </div>
      ) : loadError && questions.length === 0 ? (
        <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">题库加载失败：{loadError}</p>
          <Button onClick={() => void load(true)} variant="outline" className="min-h-11">
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
            重试
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {questions.length === 0 ? (
            <>
              题库还是空的，先去
              <button className="mx-1 font-medium text-primary underline" onClick={onGoImport}>
                导入题库
              </button>
              吧
            </>
          ) : scope !== 'all' ? (
            `「${scope === 'wrong' ? '错题本' : '收藏'}」暂无题目`
          ) : (
            '没有符合条件的题目'
          )}
        </div>
      ) : (
        <ScrollArea className="max-h-none sm:max-h-[60vh] sm:overflow-y-auto sm:pr-2">
          <ol className="space-y-2">
            {filtered.map((q, idx) => {
              const open = expanded.has(q.id)
              return (
                <li key={q.id} className="rounded-lg border bg-card">
                  <div className="flex items-start gap-1 p-3">
                    <button
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      onClick={() => toggle(q.id)}
                      aria-expanded={open}
                    >
                      <Badge variant="secondary" className="mt-0.5 shrink-0">
                        {TYPE_LABELS[q.type as QuestionType] ?? q.type}
                      </Badge>
                      {q.wrong && (
                        <Badge variant="outline" className="mt-0.5 shrink-0 border-red-300 text-red-500">
                          错{q.wrongCount}次
                        </Badge>
                      )}
                      <span className="min-w-0 flex-1 text-sm leading-relaxed">
                        <span className="mr-1 text-muted-foreground">{idx + 1}.</span>
                        {q.stem}
                      </span>
                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>
                    <button
                      onClick={() => void toggleStar(q.id, q.starred)}
                      disabled={starBusyId === q.id}
                      aria-label={q.starred ? '取消收藏' : '收藏本题'}
                      aria-pressed={q.starred}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 disabled:opacity-50"
                    >
                      <Star
                        className={`h-4.5 w-4.5 ${q.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                        aria-hidden
                      />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-2 border-t px-3 py-2.5 text-sm">
                      {q.options.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {q.options.map((o) => (
                            <li
                              key={o.key}
                              className={o.key === q.answer ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}
                            >
                              {o.key}. {o.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p>
                        <span className="text-muted-foreground">答案：</span>
                        <span className={q.answer ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}>
                          {q.answer || '（原文无答案）'}
                        </span>
                      </p>
                      {/* 解析 + AI 追问 */}
                      <ExplanationWithAsk question={q} />
                      <div className="flex flex-wrap justify-end gap-1 pt-1">
                        {q.wrong && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-11 text-xs text-muted-foreground"
                            onClick={() => void removeWrong(q.id)}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                            移出错题本
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 text-xs text-muted-foreground"
                          onClick={() => void removeOne(q.id)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                          删除本题
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </ScrollArea>
      )}
    </div>
  )
}
