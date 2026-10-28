'use client'

// AI 设置：配置硅基流动 API Key（DeepSeek 模型）
// 隐私：Key 仅保存在本机浏览器 localStorage，输入框密码态显示，不进任何代码仓库
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  AiStatus,
  AiTestResult,
  fetchAiStatus,
  getAiKey,
  saveAiKey,
  testAiConnection,
} from '@/lib/api-client'

export function AiSettings() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AiTestResult | null>(null)

  const refresh = useCallback(async () => {
    setLoadingStatus(true)
    try {
      setStatus(await fetchAiStatus())
    } catch {
      setStatus(null)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setKeyInput(getAiKey())
      setTestResult(null)
      void refresh()
    }
  }, [open, refresh])

  const handleSave = () => {
    saveAiKey(keyInput)
    toast({
      title: keyInput.trim() ? 'API Key 已保存' : '已清除 API Key',
      description: '仅保存在本机浏览器中，不会上传到代码仓库',
    })
    void refresh()
  }

  const handleClear = () => {
    setKeyInput('')
    saveAiKey('')
    toast({ title: '已清除 API Key' })
    void refresh()
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testAiConnection(keyInput.trim() || undefined)
      setTestResult(r)
      if (r.ok) saveAiKey(keyInput) // 测试通过顺手保存
    } catch (e) {
      setTestResult({ ok: false, model: status?.model ?? '', error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="AI 设置（配置硅基流动 API Key）"
        >
          <KeyRound className="h-4.5 w-4.5" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            AI 设置（硅基流动 · DeepSeek）
          </DialogTitle>
          <DialogDescription>
            题库识别与 AI 解析均通过硅基流动 API 调用 deepseek 模型。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 当前状态 */}
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5">
            {loadingStatus ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                正在获取状态…
              </p>
            ) : status ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">当前服务：</span>
                  <Badge variant={status.provider === 'siliconflow' ? 'default' : 'secondary'}>
                    {status.provider === 'siliconflow' ? '硅基流动' : '内置（仅开发调试）'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{status.model}</span>
                </p>
                {status.keyPreview && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    本机 Key：<code className="rounded bg-muted px-1">{status.keyPreview}</code>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{status.hint}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">状态获取失败，请稍后重试</p>
            )}
          </div>

          {/* Key 输入 */}
          <div className="space-y-2">
            <label htmlFor="ai-key-input" className="text-sm font-medium">
              硅基流动 API Key
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="ai-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              <Button variant="outline" onClick={handleSave} className="shrink-0">
                保存
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Key 仅保存在本机浏览器并密码态显示；也可由部署者在平台环境变量 SILICONFLOW_API_KEY
              中配置（优先级：本机填写 &gt; 环境变量）。
            </p>
          </div>

          {/* 测试连接 */}
          <div className="space-y-2">
            <Button onClick={() => void handleTest()} disabled={testing} className="w-full min-h-11">
              {testing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <PlugZap className="mr-2 h-4 w-4" aria-hidden />
              )}
              测试连接（会发送一条极小的测试消息）
            </Button>
            {testResult && (
              <div
                className={`rounded-lg border p-3 text-xs leading-relaxed ${
                  testResult.ok
                    ? 'border-emerald-500/50 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-red-400/50 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                }`}
                role="status"
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {testResult.ok ? `连接成功 · ${testResult.model} · ${testResult.ms ?? 0}ms` : '连接失败'}
                </p>
                {testResult.ok && testResult.reply && <p className="mt-1">模型回复：{testResult.reply}</p>}
                {testResult.error && <p className="mt-1 break-all">{testResult.error}</p>}
              </div>
            )}
          </div>

          <Separator />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              隐私说明：Key 永不写入代码仓库；部署平台 Secrets 中的环境变量对访客不可见。
            </p>
            <Button variant="ghost" size="sm" onClick={handleClear} className="shrink-0 text-muted-foreground">
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
              清除
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
