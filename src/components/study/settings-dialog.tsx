'use client'

// 设置对话框：AI Key / 模型 / GitHub 云同步 / 数据管理
// 设计对齐 Zepp-Steps-Automation 的「凭据使用者本人提供」模式：
// Key 与 PAT 只存本机浏览器，云端数据文件不含任何凭据
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  CloudDownload,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/settings-store'
import { useQuestionStore, StoredQuestion } from '@/lib/question-store'
import { syncToGitHub, pullFromGitHub, buildReviewData, ReviewData } from '@/lib/github-sync'
import { chatSafe } from '@/lib/ai'
import { clearParseCache } from '@/lib/parse-cache'

export function SettingsDialog() {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [showPat, setShowPat] = useState(false)
  const [testing, setTesting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pulling, setPulling] = useState(false)

  const s = useSettingsStore()
  const questions = useQuestionStore((st) => st.questions)
  const importAll = useQuestionStore((st) => st.importAll)

  const update = useCallback(
    (patch: Parameters<typeof s.update>[0]) => s.update(patch),
    [s]
  )

  // ---------- AI 测试 ----------
  const testKey = useCallback(async () => {
    if (!s.hasKey()) {
      toast({ title: '请先填写 API Key 和模型名', variant: 'destructive' })
      return
    }
    setTesting(true)
    try {
      await chatSafe(
        [
          { role: 'system', content: '你是连通性测试器，只回复两个字：正常' },
          { role: 'user', content: 'ping' },
        ],
        { apiKey: s.apiKey.trim(), model: s.model.trim(), baseUrl: s.baseUrl.trim(), timeoutMs: 20_000 }
      )
      toast({ title: '✓ AI 连接正常', description: `模型 ${s.model} 可用` })
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

  // 合并/覆盖写入（按题干去重，保留学习进度）
  const applyRestored = useCallback((remote: StoredQuestion[], mode: 'replace' | 'merge'): number => {
    return useQuestionStore.getState().restoreAll(remote, mode)
  }, [])

  // ---------- 云同步 ----------
  const doUpload = useCallback(async () => {
    if (!s.hasSync()) {
      toast({ title: '请先填写 GitHub PAT 和仓库名', variant: 'destructive' })
      return
    }
    setUploading(true)
    try {
      await syncToGitHub(questions)
      toast({ title: '已上传到 GitHub', description: `共 ${questions.length} 题 → ${s.ghRepo}/data/review-data.json` })
    } catch (e) {
      toast({
        title: '上传失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }, [s, questions, toast])

  const doPull = useCallback(async () => {
    setPulling(true)
    try {
      const data = await pullFromGitHub()
      const remoteCount = data.questions.length
      const localCount = questions.length
      if (localCount === 0) {
        applyRestored(data.questions, 'replace')
        toast({ title: `已恢复 ${remoteCount} 题到本机` })
      } else {
        // 云端与本机都有：合并去重（保留本机进度，只补缺的题）
        const added = applyRestored(data.questions, 'merge')
        toast({
          title: added > 0 ? `已合并 ${added} 题` : '云端与本机数据一致',
          description: added > 0 ? `云端 ${remoteCount} 题，本机原有 ${localCount} 题` : undefined,
        })
      }
    } catch (e) {
      toast({
        title: '恢复失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setPulling(false)
    }
  }, [questions, applyRestored, toast])

  // ---------- 数据管理 ----------
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

  const lastSync = s.lastSyncAt > 0 ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '从未'

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
          {!s.hasKey() && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-md overflow-hidden p-0 sm:w-full">
        <ScrollArea className="max-h-[80vh]">
          <div className="space-y-5 p-5">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                设置
                {!s.hasKey() && <Badge variant="destructive">未配置 AI</Badge>}
              </DialogTitle>
              <DialogDescription>
                API Key 与 PAT 只保存在本机浏览器，不上传任何服务器
              </DialogDescription>
            </DialogHeader>

            {/* ---------- AI 设置 ---------- */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">AI 识别（硅基流动）</h3>
              <div className="space-y-1.5">
                <Label htmlFor="set-key">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="set-key"
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-…（cloud.siliconflow.cn 获取）"
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
                  placeholder="deepseek-ai/DeepSeek-V4.1-Flash"
                  value={s.model}
                  onChange={(e) => update({ model: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-base">接口地址（一般不用改）</Label>
                <Input
                  id="set-base"
                  placeholder="https://api.siliconflow.cn/v1"
                  value={s.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  className="h-11"
                />
              </div>
              <Button variant="outline" className="min-h-11 w-full" onClick={() => void testKey()} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                测试连接
              </Button>
            </section>

            <Separator />

            {/* ---------- GitHub 云同步 ---------- */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">GitHub 云同步（可选）</h3>
                <div className="flex items-center gap-2">
                  <Label htmlFor="set-autosync" className="text-xs text-muted-foreground">
                    自动
                  </Label>
                  <Switch
                    id="set-autosync"
                    checked={s.autoSync}
                    onCheckedChange={(v) => update({ autoSync: v })}
                  />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                像 state.json 一样把学习数据存到你自己的仓库（data/review-data.json），
                换手机/电脑可恢复。数据不含 Key 和 PAT。
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="set-pat">GitHub Token（PAT）</Label>
                <div className="flex gap-2">
                  <Input
                    id="set-pat"
                    type={showPat ? 'text' : 'password'}
                    placeholder="ghp_…（Settings → Developer settings）"
                    value={s.ghPat}
                    onChange={(e) => update({ ghPat: e.target.value })}
                    autoComplete="off"
                    className="h-11"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label={showPat ? '隐藏 Token' : '显示 Token'}
                    onClick={() => setShowPat((v) => !v)}
                  >
                    {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-repo">仓库名</Label>
                <Input
                  id="set-repo"
                  placeholder="xiaobaiba999/final-exam-review"
                  value={s.ghRepo}
                  onChange={(e) => update({ ghRepo: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => void doUpload()} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
                  上传备份
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => void doPull()} disabled={pulling}>
                  {pulling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
                  从云端恢复
                </Button>
              </div>
              {s.lastSyncMsg && (
                <p className="text-xs text-muted-foreground">
                  上次同步：{lastSync} · {s.lastSyncMsg}
                </p>
              )}
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
                  <span>清空本机全部数据</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-h-9"
                  onClick={() => {
                    if (confirm(`确定清空全部 ${questions.length} 道题吗？此操作不可恢复（建议先上传备份）`)) {
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
              数据默认保存在本机浏览器（IndexedDB）· 清除浏览器数据前请先备份
            </p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
