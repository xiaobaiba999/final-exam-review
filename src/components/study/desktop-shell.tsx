'use client'

import {
  BarChart3,
  BookOpen,
  FilePlus2,
  GraduationCap,
  LogOut,
  QrCode,
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore, type AppView } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { MobileAccessDialog } from '@/components/study/mobile-access-dialog'
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
import { cn } from '@/lib/utils'
import { BanksView } from '@/components/study/banks-view'
import { BrowseView } from '@/components/study/browse-view'
import { ImportWizard } from '@/components/study/import-wizard'
import { ReviewView } from '@/components/study/review-view'
import { SetupView } from '@/components/study/setup-view'
import { StatsView } from '@/components/study/stats-view'

/** 桌面端壳（顶部导航 + 粘底 footer），移动端由独立组件树 MobileApp 接管 */
export function DesktopShell() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const endReview = useAppStore((s) => s.endReview)
  const inReview = view === 'review'
  const [mobileAccessOpen, setMobileAccessOpen] = useState(false)

  const navItems: { key: AppView; label: string; icon: typeof BookOpen }[] = [
    { key: 'banks', label: '题库', icon: BookOpen },
    { key: 'import', label: '导入', icon: FilePlus2 },
    { key: 'stats', label: '统计', icon: BarChart3 },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setView('banks')}
            className="flex min-h-11 items-center gap-2 text-left transition-opacity hover:opacity-80"
            aria-label="期末复习助手，回到题库首页"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
              <GraduationCap className="size-5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight">期末复习助手</span>
              <span className="hidden text-[11px] text-stone-500 dark:text-zinc-400 sm:block">
                导入题库 · 科学复习 · 考前冲刺
              </span>
            </span>
          </button>

          {inReview ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  <LogOut className="size-4" />
                  退出复习
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确定退出本次复习吗？</AlertDialogTitle>
                  <AlertDialogDescription>
                    已作答题目的结果已经保存，退出后将返回复习设置页，本次会话进度不会保留。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>继续复习</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 text-white hover:bg-red-700"
                    onClick={() => endReview()}
                  >
                    退出复习
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <nav className="flex items-center gap-1 sm:gap-2" aria-label="主导航">
              <Button
                variant="ghost"
                size="sm"
                className="h-11 px-3 text-sm font-medium text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                onClick={() => setMobileAccessOpen(true)}
                aria-label="手机扫码访问"
              >
                <QrCode className="size-4" />
                <span className="hidden sm:inline">手机访问</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-11 px-3 text-sm font-medium transition-colors',
                  view === 'stats'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
                onClick={() => setView('stats')}
                aria-label="打开统计"
                aria-current={view === 'stats' ? 'page' : undefined}
              >
                <BarChart3 className="size-4" />
                统计
              </Button>
              <Button
                size="sm"
                className="h-11 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                onClick={() => setView('import')}
                aria-label="导入新题库"
              >
                <FilePlus2 className="size-4" />
                导入题库
              </Button>
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:px-6 sm:py-8 lg:pb-8">
        {view === 'banks' && <BanksView />}
        {view === 'import' && <ImportWizard />}
        {view === 'browse' && <BrowseView />}
        {view === 'setup' && <SetupView />}
        {view === 'review' && <ReviewView />}
        {view === 'stats' && <StatsView />}
      </main>

      <footer className="mt-auto hidden border-t border-stone-200 bg-white/60 py-4 dark:border-zinc-800 dark:bg-zinc-900/60 sm:block">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-4 text-xs text-stone-500 dark:text-zinc-400 sm:px-6">
          <GraduationCap className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>期末复习助手 · 祝你考试顺利 🎓</span>
        </div>
      </footer>

      {/* 手机扫码访问弹窗 */}
      <MobileAccessDialog open={mobileAccessOpen} onOpenChange={setMobileAccessOpen} />

      {/* 移动端底部 Tab 导航（App 风格，复习中隐藏保持沉浸） */}
      {!inReview && (
        <nav
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 sm:hidden"
          aria-label="底部导航"
        >
          <div className="grid h-16 grid-cols-3">
            {navItems.map(({ key, label, icon: Icon }) => {
              const active = view === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center gap-0.5 transition-colors',
                    active
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-stone-500 active:text-emerald-600 dark:text-zinc-400 dark:active:text-emerald-400',
                  )}
                  aria-label={`打开${label}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={cn('size-5', active && 'fill-emerald-100 dark:fill-emerald-950')} />
                  <span className={cn('text-[10px]', active && 'font-semibold')}>{label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      )}
    </div>
  )
}
