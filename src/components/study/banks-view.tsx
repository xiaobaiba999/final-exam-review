'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FileText,
  Layers,
  ListChecks,
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'

export function BanksView() {
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

  const load = useCallback(async () => {
    try {
      const list = await listBanks()
      setBanks(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载题库列表失败')
    }
  }, [])

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

  const statCards = [
    { label: '题库数', value: banks ? String(safeBanks.length) : '—', icon: Layers, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: '总题数', value: banks ? String(totalQuestions) : '—', icon: FileText, tone: 'text-stone-600 dark:text-zinc-300' },
    { label: '已掌握', value: banks ? String(totalKnown) : '—', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: '错题', value: banks ? String(totalWrong) : '—', icon: CircleAlert, tone: 'text-amber-600 dark:text-amber-400' },
  ]

  return (
    <section aria-label="题库列表" className="animate-in fade-in duration-300">
      {/* 顶部统计条 */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, tone }) => (
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

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">我的题库</h2>
          <p className="text-sm text-stone-500 dark:text-zinc-400">
            选择一个题库开始复习，或进入浏览编辑
          </p>
        </div>
        <Button
          className="h-11 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
          onClick={() => setView('import')}
        >
          <Plus className="size-4" />
          导入题库
        </Button>
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
      {banks === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="gap-4">
              <CardHeader className="gap-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-5 w-14" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {banks !== null && banks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <BookOpen className="size-8" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">还没有题库</h3>
            <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-zinc-400">
              上传 Word / PDF / TXT 复习资料，或直接粘贴题目文本，自动识别整理成你的专属题库
            </p>
          </div>
          <Button
            size="lg"
            className="mt-2 h-12 bg-emerald-600 px-8 text-base text-white shadow-sm hover:bg-emerald-700"
            onClick={() => setView('import')}
          >
            <Plus className="size-5" />
            导入题库
          </Button>
        </div>
      )}

      {/* 题库卡片 */}
      {banks !== null && banks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((bank) => {
            const pct = bank.total > 0 ? Math.round((bank.known / bank.total) * 100) : 0
            const typeEntries = QUESTION_TYPE_ORDER.filter((t) => (bank.typeCounts[t] || 0) > 0)
            return (
              <Card key={bank.id} className="gap-4 pb-4 transition-shadow hover:shadow-md">
                <CardHeader className="gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-1 text-base">{bank.name}</CardTitle>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-emerald-600"
                        aria-label={`重命名题库「${bank.name}」`}
                        onClick={() => {
                          setRenameTarget(bank)
                          setRenameValue(bank.name)
                        }}
                      >
                        <PencilLine className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-red-600"
                        aria-label={`删除题库「${bank.name}」`}
                        onClick={() => setDeleteTarget(bank)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="line-clamp-1">
                    {bank.source || '手动创建'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                      <span>已掌握 {bank.known}/{bank.total}</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{pct}%</span>
                    </div>
                    <Progress
                      value={pct}
                      className="h-2 bg-stone-200 dark:bg-zinc-800 [&>div]:bg-emerald-500"
                      aria-label={`题库「${bank.name}」掌握进度 ${pct}%`}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {typeEntries.map((t) => (
                      <QuestionTypeBadge key={t} type={t} className="text-[11px]">
                        {`${QUESTION_TYPE_LABEL[t]} ×${bank.typeCounts[t]}`}
                      </QuestionTypeBadge>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <CircleAlert className="size-3.5 text-amber-500" />
                      错题 {bank.wrong}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 text-amber-400" />
                      收藏 {bank.starred}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1">
                      <ListChecks className="size-3.5" />
                      {bank.total} 题
                    </span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      className="h-11 flex-1 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                      onClick={() => startReview(bank)}
                      disabled={bank.total === 0}
                    >
                      <PlayCircle className="size-4" />
                      开始复习
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 flex-1"
                      onClick={() => openBank(bank.id, bank.name)}
                    >
                      <BookOpen className="size-4" />
                      浏览编辑
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

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
