'use client'

import { BarChart3, BookOpen, FilePlus2, GraduationCap } from 'lucide-react'
import { useAppStore, type AppView } from '@/lib/store'
import { cn } from '@/lib/utils'
import { MobileBanks } from '@/components/mobile/mobile-banks'
import { MobileBrowse } from '@/components/mobile/mobile-browse'
import { MobileImport } from '@/components/mobile/mobile-import'
import { MobileReview } from '@/components/mobile/mobile-review'
import { MobileSetup } from '@/components/mobile/mobile-setup'
import { MobileStats } from '@/components/mobile/mobile-stats'

const TAB_ITEMS: { key: AppView; label: string; icon: typeof BookOpen }[] = [
  { key: 'banks', label: '题库', icon: BookOpen },
  { key: 'import', label: '导入', icon: FilePlus2 },
  { key: 'stats', label: '统计', icon: BarChart3 },
]

const TAB_VIEWS: AppView[] = ['banks', 'import', 'stats']

/**
 * 独立移动端 App（仅手机 / 窄视口渲染）：
 * - 一级 Tab（题库/导入/统计）：App 顶栏 + 底部 Tab 导航
 * - 子页面（浏览/复习设置）：全屏推入，自带返回顶栏，隐藏 Tab
 * - 复习：完全沉浸，无 Tab 无顶栏，复习视图自带迷你头部与吸底操作栏
 */
export function MobileApp() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)

  const isTab = TAB_VIEWS.includes(view)
  const immersive = view === 'review'

  return (
    <div className="flex min-h-screen flex-col bg-stone-100 text-stone-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* App 顶栏（仅一级 Tab 页） */}
      {isTab && (
        <header className="safe-top sticky top-0 z-30 border-b border-stone-200/80 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <div className="flex h-14 items-center gap-2.5 px-4">
            <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <GraduationCap className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-tight">期末复习助手</span>
              <span className="truncate text-[11px] text-stone-400 dark:text-zinc-500">
                导入题库 · 科学复习 · 考前冲刺
              </span>
            </div>
          </div>
        </header>
      )}

      <main className="flex-1">
        {view === 'banks' && <MobileBanks />}
        {view === 'import' && <MobileImport />}
        {view === 'browse' && <MobileBrowse />}
        {view === 'setup' && <MobileSetup />}
        {view === 'review' && <MobileReview />}
        {view === 'stats' && <MobileStats />}
      </main>

      {/* 底部 Tab 导航（子页面与复习中隐藏） */}
      {isTab && (
        <nav
          className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          aria-label="底部导航"
        >
          <div className="grid h-16 grid-cols-3">
            {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
              const active = view === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center gap-0.5 transition-colors active:scale-95',
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
