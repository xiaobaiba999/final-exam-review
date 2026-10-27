'use client'

// 期末复习助手：导入题库 / 题库管理 / 复习模式
// 纯本地版：无后端/无数据库，数据存浏览器 IndexedDB，AI 由浏览器直连硅基流动
// 移动端优先：底部 Tab 导航（拇指友好）、44px+ 触控目标、底部安全区适配
import { useEffect, useState } from 'react'
import { BookOpen, GraduationCap, ListChecks, Upload } from 'lucide-react'
import { ImportWizard } from '@/components/study/import-wizard'
import { QuestionBank } from '@/components/study/question-bank'
import { StudyMode } from '@/components/study/study-mode'
import { SettingsDialog } from '@/components/study/settings-dialog'
import { useQuestionStore } from '@/lib/question-store'
import { useSettingsStore } from '@/lib/settings-store'

type Tab = 'import' | 'bank' | 'study'

const TABS: Array<{ key: Tab; label: string; icon: typeof Upload }> = [
  { key: 'import', label: '导入', icon: Upload },
  { key: 'bank', label: '题库', icon: ListChecks },
  { key: 'study', label: '复习', icon: GraduationCap },
]

export default function Home() {
  const [tab, setTab] = useState<Tab>('import')
  const hasKey = useSettingsStore((s) => Boolean(s.apiKey.trim()))

  // 预取题库：等待 IndexedDB 恢复完成后即数据就绪（本地秒开）
  useEffect(() => {
    void useQuestionStore.getState().load()
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-tight">期末复习助手</h1>
            <p className="truncate text-xs text-muted-foreground">
              AI 题库识别 · 错题本 · 收藏 · 顺序/乱序/背题
            </p>
          </div>
          <SettingsDialog />
        </div>
      </header>

      {/* 内容 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-6 pt-4">
        <div role="tabpanel">
          {tab === 'import' && (
            <ImportWizard
              onImported={() => {
                // 导入成功：强制刷新共享题库，并自动跳转题库让结果立即可见
                void useQuestionStore.getState().load(true)
                setTab('bank')
              }}
            />
          )}
          {tab === 'bank' && <QuestionBank onGoImport={() => setTab('import')} />}
          {tab === 'study' && <StudyMode onGoImport={() => setTab('import')} />}
        </div>
      </main>

      {/* 吸底：底部 Tab 导航（内容不足一屏时贴底，超出时自然下推） */}
      <footer className="mt-auto border-t bg-background pb-[max(env(safe-area-inset-bottom),0px)]">
        <p className="pb-1 pt-1.5 text-center text-[10px] leading-none text-muted-foreground">
          {hasKey
            ? '数据保存在本机浏览器 · 可在设置中开启 GitHub 云同步'
            : '首次使用：点击右上角⚙填入 AI Key 即可识别题库'}
        </p>
        <nav aria-label="主导航">
          <div className="mx-auto grid w-full max-w-3xl grid-cols-3">
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = tab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 transition-colors active:bg-accent ${
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className={`text-[11px] leading-none ${active ? 'font-semibold' : ''}`}>{label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      </footer>
    </div>
  )
}
