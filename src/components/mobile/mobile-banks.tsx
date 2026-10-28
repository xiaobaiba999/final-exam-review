'use client'

import { useEffect, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  FileText,
  MoreVertical,
  PencilLine,
  PlayCircle,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { deleteBank, listBanks, renameBank } from '@/lib/api-client'
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  type BankSummary,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

/** 移动端题库首页：概览统计 + 全宽题库卡片 + 悬浮导入按钮 */
export function MobileBanks() {
  const banksVersion = useAppStore((s) => s.banksVersion)
  const setView = useAppStore((s) => s.setView)
  const openBank = useAppStore((s) => s.openBank)
  const refreshBanks = useAppStore((s) => s.refreshBanks)

  const [banks, setBanks] = useState<BankSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<BankSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BankSummary | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await listBanks()
        if (!cancelled) {
          setBanks(list)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载题库列表失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [banksVersion])

  const startReview = (bank: BankSummary) => {
    openBank(bank.id, bank.name)
    setView('setup')
  }

  const handleRename = async () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name) {
      toast({ title: '请输入题库名称', variant: 'destructive' })
      return
    }
    setRenameSaving(true)
    try {
      await renameBank(renameTarget.id, name)
      toast({ title: '重命名成功', description: `题库已更名为「${name}」` })
      setRenameTarget(null)
      refreshBanks()
    } catch (e) {
      toast({
        title: '重命名失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setRenameSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteSaving(true)
    try {
      await deleteBank(deleteTarget.id)
      toast({ title: '题库已删除', description: `「${deleteTarget.name}」及其题目已移除` })
      setDeleteTarget(null)
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

  const safeBanks = banks || []
  const totalQuestions = safeBanks.reduce((acc, b) => acc + b.total, 0)
  const totalKnown = safeBanks.reduce((acc, b) => acc + b.known, 0)
  const totalWrong = safeBanks.reduce((acc, b) => acc + b.wrong, 0)

  const statChips = [
    { label: '总题数', value: banks ? String(totalQuestions) : '—', tone: 'text-stone-700 dark:text-zinc-200' },
    { label: '已掌握', value: banks ? String(totalKnown) : '—', tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: '错题', value: banks ? String(totalWrong) : '—', tone: 'text-amber-600 dark:text-amber-400' },
  ]

  return (
    <section aria-label="题库列表" className="animate-in fade-in px-4 pb-28 pt-4 duration-300">
      {/* 概览统计 */}
      <div className="grid grid-cols-3 gap-2.5">
        {statChips.map(({ label, value, tone }) => (
          <div
            key={label}
            className="rounded-xl border border-stone-200/80 bg-white px-3 py-2.5 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className={cn('text-xl font-bold leading-tight tabular-nums', tone)}>{value}</p>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-zinc-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 mt-5 flex items-end justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">
          我的题库
          {banks !== null && banks.length > 0 && (
            <span className="ml-1.5 text-sm font-medium text-stone-400 dark:text-zinc-500">
              {banks.length} 个
            </span>
          )}
        </h2>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex-1">{error}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
            onClick={() => refreshBanks()}
          >
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架 */}
      {banks === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="space-y-3 rounded-2xl border border-stone-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-2 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-11 flex-1" />
                <Skeleton className="h-11 flex-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {banks !== null && banks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-stone-300 bg-white/70 px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <BookOpen className="size-8" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">还没有题库</h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-zinc-400">
              上传 Word / PDF 复习资料，或直接粘贴题目文本，一键整理成专属题库
            </p>
          </div>
          <Button
            size="lg"
            className="mt-1 h-12 bg-emerald-600 px-8 text-base text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setView('import')}
          >
            <Plus className="size-5" />
            导入题库
          </Button>
        </div>
      )}

      {/* 题库卡片 */}
      {banks !== null && banks.length > 0 && (
        <div className="space-y-3">
          {banks.map((bank) => {
            const pct = bank.total > 0 ? Math.round((bank.known / bank.total) * 100) : 0
            const typeEntries = QUESTION_TYPE_ORDER.filter((t) => (bank.typeCounts[t] || 0) > 0)
            return (
              <article
                key={bank.id}
                className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm transition-shadow active:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* 标题行：点击进入浏览 */}
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openBank(bank.id, bank.name)}
                    aria-label={`浏览题库「${bank.name}」`}
                  >
                    <h3 className="flex items-center gap-1 truncate text-base font-semibold text-stone-900 dark:text-zinc-50">
                      <span className="truncate">{bank.name}</span>
                      <ChevronRight className="size-4 shrink-0 text-stone-300 dark:text-zinc-600" />
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-stone-400 dark:text-zinc-500">
                      {bank.source || '手动创建'}
                    </p>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-1 size-9 shrink-0 text-stone-400 dark:text-zinc-500"
                        aria-label={`题库「${bank.name}」更多操作`}
                      >
                        <MoreVertical className="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameTarget(bank)
                          setRenameValue(bank.name)
                        }}
                      >
                        <PencilLine className="size-4" />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-700 dark:text-red-400"
                        onSelect={() => setDeleteTarget(bank)}
                      >
                        <Trash2 className="size-4" />
                        删除题库
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* 进度 */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                    <span>已掌握 {bank.known}/{bank.total}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{pct}%</span>
                  </div>
                  <Progress
                    value={pct}
                    className="h-2 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
                    aria-label={`题库「${bank.name}」掌握进度 ${pct}%`}
                  />
                </div>

                {/* 题型徽章（横向滑动） */}
                {typeEntries.length > 0 && (
                  <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
                    {typeEntries.map((t) => (
                      <QuestionTypeBadge key={t} type={t} className="shrink-0 text-[11px]">
                        {`${QUESTION_TYPE_LABEL[t]} ×${bank.typeCounts[t]}`}
                      </QuestionTypeBadge>
                    ))}
                  </div>
                )}

                {/* 元信息 */}
                <div className="mt-3 flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1">
                    <CircleAlert className="size-3.5 text-amber-500" />
                    错题 {bank.wrong}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 text-amber-400" />
                    收藏 {bank.starred}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    <FileText className="size-3.5" />
                    {bank.total} 题
                  </span>
                </div>

                {/* 操作 */}
                <div className="mt-3.5 flex gap-2">
                  <Button
                    className="h-11 flex-1 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
                    onClick={() => startReview(bank)}
                    disabled={bank.total === 0}
                  >
                    <PlayCircle className="size-4" />
                    开始复习
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 flex-1 border-stone-300 dark:border-zinc-700"
                    onClick={() => openBank(bank.id, bank.name)}
                  >
                    <BookOpen className="size-4" />
                    浏览编辑
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* 悬浮导入按钮 */}
      <button
        type="button"
        onClick={() => setView('import')}
        className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 transition-transform active:scale-90"
        aria-label="导入新题库"
      >
        <Plus className="size-6" />
      </button>

      {/* 重命名对话框 */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名题库</DialogTitle>
            <DialogDescription>为题库取一个好记的名字</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="题库名称"
            aria-label="题库名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRename()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={renameSaving}>
              取消
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void handleRename()}
              disabled={renameSaving || !renameValue.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题库「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除该题库及全部 {deleteTarget?.total ?? 0} 道题目与复习进度，此操作不可撤销。
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
