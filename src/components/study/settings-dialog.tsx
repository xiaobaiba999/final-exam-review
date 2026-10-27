'use client'

// 设置对话框（多用户版）：
// 1. 用户：当前账号 + 退出登录
// 2. AI：公共 API（免配置）/ 我的 API（硅基流动 / DeepSeek 官方 / 自定义）
// 3. 数据管理：导出 / 导入 / 清空（换设备迁移用文件，不再走 GitHub）
// Key 只存本机浏览器，按用户隔离
import { useCallback, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  LogOut,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react'
import { useUserStore } from '@/lib/user-store'
import {
  useSettingsStore,
  resolveAi,
  publicAiAvailable,
  PROVIDER_PRESETS,
  AiProvider,
  PUBLIC_AI,
} from '@/lib/settings-store'
import { useQuestionStore, StoredQuestion } from '@/lib/question-store'
import { buildReviewData, ReviewData } from '@/lib/review-data'
import { chatSafe } from '@/lib/ai'
import { clearParseCache } from '@/lib/parse-cache'

export function SettingsDialog() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)

  const s = useSettingsStore()
  const questions = useQuestionStore((st) => st.questions)
  const logout = useUserStore((st) => st.logout)
  const current = useUserStore((st) => st.current)

  const update = useCallback(
    (patch: Parameters<typeof s.update>[0]) => s.update(patch),
    [s]
  )

  // ---------- AI 测试（按当前来源解析凭据） ----------
  const testKey = useCallback(async () => {
    const ai = resolveAi(s)
    if (!ai.ok) {
      toast({
        title: s.source === 'public' ? '公共 API 未配置' : '请先填写 API Key 和接口地址',
        variant: 'destructive',
      })
      return
    }
    setTesting(true)
    try {
      await chatSafe(
        [
          { role: 'system', content: '你是连通性测试器，只回复两个字：正常' },
          { role: 'user', content: 'ping' },
        ],
        { apiKey: ai.key, model: ai.model, baseUrl: ai.baseUrl, timeoutMs: 20_000 }
      )
      toast({ title: '✓ 连接正常', description: `${ai.label} · 模型 ${ai.model} 可用` })
    } catch (e) {
      toast({
        title: '连接失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setTesting(false)
    }
  }, [s, toast])

  // ---------- 数据管理（换设备迁移用文件） ----------
  const fileRef = useRef<HTMLInputElement>(null)
  const exportJson = useCallback(() => {
    const data = buildReviewData(questions)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `exam-review-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [questions])

  const applyRestored = useCallback((remote: StoredQuestion[], mode: 'replace' | 'merge'): number => {
    return useQuestionStore.getState().restoreAll(remote, mode)
  }, [])

  const importJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const data = JSON.parse(text) as ReviewData
        if (data?.app !== 'exam-review' || !Array.isArray(data.questions)) {
          throw new Error('文件格式不正确')
        }
        const n = applyRestored(data.questions, 'merge')
        toast({ title: `已导入 ${n} 题（按题干去重合并）` })
      } catch (e) {
        toast({
          title: '导入失败',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      }
    },
    [applyRestored, toast]
  )

  const clearAll = useCallback(() => {
    useQuestionStore.getState().clear()
    clearParseCache()
    toast({ title: '已清空本机题库与识别缓存' })
  }, [toast])

  const ai = resolveAi(s)
  const sourcePublic = s.source === 'public'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开设置"
          className="relative h-10 w-10 shrink-0"
        >
          <Settings className="h-5 w-5" aria-hidden />
          {!ai.ok && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-md overflow-hidden p-0 sm:w-full">
        <ScrollArea className="max-h-[80vh]">
          <div className="space-y-5 p-5">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                设置
                {!ai.ok && <Badge variant="destructive">AI 不可用</Badge>}
              </DialogTitle>
              <DialogDescription>Key 只保存在本机浏览器，按账号隔离</DialogDescription>
            </DialogHeader>

            {/* ---------- 用户 ---------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">账号</h3>
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{current ?? '未登录'}</p>
                    <p className="text-[11px] text-muted-foreground">本机账号 · 数据仅存此设备</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="min-h-9 shrink-0" onClick={logout}>
                  <LogOut className="mr-1 h-3.5 w-3.5" />
                  退出
                </Button>
              </div>
            </section>

            {/* ---------- AI 设置 ---------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">AI 识别</h3>

              {/* 来源切换 */}
              <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="API 来源">
                <button
                  role="radio"
                  aria-checked={sourcePublic}
                  onClick={() => update({ source: 'public' })}
                  className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    sourcePublic ? 'border-primary bg-primary/5' : 'bg-background hover:bg-accent'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      sourcePublic ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Globe className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      公共 API
                      {publicAiAvailable ? (
                        <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">
                          可用
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          未配置
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">站长内置，免配置直接用</p>
                  </div>
                  {sourcePublic && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                </button>

                <button
                  role="radio"
                  aria-checked={!sourcePublic}
                  onClick={() => update({ source: 'own' })}
                  className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    !sourcePublic ? 'border-primary bg-primary/5' : 'bg-background hover:bg-accent'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      !sourcePublic ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <KeyRound className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      我的 API
                      {s.apiKey.trim().length > 10 ? (
                        <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">
                          已填 Key
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          未填 Key
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">用自己申请的 Key，额度自己掌控</p>
                  </div>
                  {!sourcePublic && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                </button>
              </div>

              {/* 公共模式提示 */}
              {sourcePublic && (
                <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  {publicAiAvailable ? (
                    <>
                      正在使用公共 API（{PUBLIC_AI.model}）。适合轻度使用；识别量大或遇到限流时，
                      建议切换到「我的 API」用自己的 Key。
                    </>
                  ) : (
                    <>
                      站长还未配置公共 API。请切换到「我的 API」，
                      去硅基流动（cloud.siliconflow.cn）或 DeepSeek 开放平台申请个 Key 填入即可。
                    </>
                  )}
                </p>
              )}

              {/* 我的 API 表单 */}
              {!sourcePublic && (
                <div className="space-y-3">
                  {/* 接口商预设 */}
                  <div className="space-y-1.5">
                    <Label>选择接口</Label>
                    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="接口商">
                      {(Object.keys(PROVIDER_PRESETS) as AiProvider[]).map((p) => {
                        const preset = PROVIDER_PRESETS[p]
                        const active = s.provider === p
                        return (
                          <button
                            key={p}
                            role="radio"
                            aria-checked={active}
                            onClick={() => s.usePreset(p)}
                            className={`min-h-11 rounded-lg border px-2 py-2 text-center transition-colors ${
                              active ? 'border-primary bg-primary/5' : 'bg-background hover:bg-accent'
                            }`}
                          >
                            <span className={`block text-xs font-medium ${active ? 'text-primary' : ''}`}>
                              {preset.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{PROVIDER_PRESETS[s.provider]?.note}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="set-key">API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="set-key"
                        type={showKey ? 'text' : 'password'}
                        placeholder={PROVIDER_PRESETS[s.provider]?.keyPlaceholder}
                        value={s.apiKey}
                        onChange={(e) => update({ apiKey: e.target.value })}
                        autoComplete="off"
                        className="h-11"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                        onClick={() => setShowKey((v) => !v)}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-model">模型</Label>
                    <Input
                      id="set-model"
                      placeholder={PROVIDER_PRESETS[s.provider]?.model || '如 deepseek-chat'}
                      value={s.model}
                      onChange={(e) => update({ model: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-base">
                      接口地址
                      {s.provider !== 'custom' && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">（选接口时已自动填好）</span>
                      )}
                    </Label>
                    <Input
                      id="set-base"
                      placeholder="https://api.siliconflow.cn/v1"
                      value={s.baseUrl}
                      onChange={(e) => update({ baseUrl: e.target.value })}
                      className="h-11"
                    />
                  </div>
                </div>
              )}

              <Button variant="outline" className="min-h-11 w-full" onClick={() => void testKey()} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                测试连接
              </Button>
            </section>

            <Separator />

            {/* ---------- 数据管理 ---------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">数据管理</h3>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="min-h-11" onClick={exportJson} disabled={questions.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  导出文件
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  导入文件
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                换手机/电脑：在旧设备「导出文件」，在新设备登录后「导入文件」即可迁移题库与进度。
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importJson(f)
                  e.target.value = ''
                }}
              />
              <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
                  <span>清空本账号全部数据</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-h-9"
                  onClick={() => {
                    if (confirm(`确定清空 ${current ?? '本账号'} 的全部 ${questions.length} 道题吗？此操作不可恢复（建议先导出文件）`)) {
                      clearAll()
                    }
                  }}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  清空
                </Button>
              </div>
            </section>

            <p className="pb-1 text-center text-[11px] leading-relaxed text-muted-foreground">
              数据保存在本机浏览器（IndexedDB）· 清除浏览器数据前请先导出备份
            </p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
