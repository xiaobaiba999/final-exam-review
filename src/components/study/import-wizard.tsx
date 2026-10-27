'use client'

// 题库导入向导：上传 -> AI 流式识别 -> 预览 -> 确认入库
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import {
  AiStreamEvent,
  ParsedQuestion,
  TYPE_LABELS,
  QuestionType,
} from '@/lib/types'
import {
  importQuestions,
  runAiStream,
  shouldReconnect,
} from '@/lib/api-client'

type Phase = 'idle' | 'running' | 'preview' | 'importing'

interface Props {
  onImported: () => void
}

export function ImportWizard({ onImported }: Props) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [stageMsg, setStageMsg] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [found, setFound] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [preview, setPreview] = useState<ParsedQuestion[]>([])
  const [summary, setSummary] = useState<{
    total: number
    answered: number
    failedChunks: number
    supplement: number
    filtered: number
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // 用于递归重连的间接引用，避免 useCallback 自引用闭包问题
  const startRef = useRef<(force: boolean, attempt: number) => Promise<void>>(null!)

  const running = phase === 'running' || phase === 'importing'

  const reset = useCallback(() => {
    setPhase('idle')
    setStageMsg('')
    setProgress({ current: 0, total: 0 })
    setFound(0)
    setWarnings([])
    setPreview([])
    setSummary(null)
  }, [])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    switch (ev.type) {
      case 'stage':
        setStageMsg(ev.message)
        break
      case 'progress':
        setProgress({ current: ev.current, total: ev.total })
        setFound(ev.found)
        setStageMsg(ev.message)
        break
      case 'questions':
        setPreview((prev) => [...prev, ...ev.questions])
        break
      case 'questions-replace':
        // 终局数据：去重/补扫/答案回填后的最终结果，直接替换预览
        setPreview(ev.questions)
        break
      case 'warning':
        setWarnings((prev) => [...prev.slice(-4), ev.message])
        break
      case 'error':
        setWarnings((prev) => [...prev.slice(-4), ev.message])
        break
      case 'done':
        setSummary({
          total: ev.total,
          answered: ev.answered,
          failedChunks: ev.failedChunks,
          supplement: ev.supplement,
          filtered: ev.filtered,
        })
        setStageMsg(
          ev.failedChunks > 0
            ? `识别部分完成（${ev.failedChunks} 个片段失败）`
            : '识别完成'
        )
        break
    }
  }, [])

  const start = useCallback(
    async (force: boolean, attempt = 0) => {
      if (!file) return
      const controller = new AbortController()
      abortRef.current = controller
      setPhase('running')
      if (attempt === 0) {
        setStageMsg(force ? '强制重新识别中…' : '正在连接 AI 识别…')
        setProgress({ current: 0, total: 0 })
        setFound(0)
        setWarnings([])
        setPreview([])
        setSummary(null)
      }
      try {
        await runAiStream(
          { file, force },
          { onEvent: handleEvent },
          attempt,
          { signal: controller.signal }
        )
        setPhase('preview')
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          reset()
          return
        }
        if (shouldReconnect(e, attempt)) {
          toast({
            title: `连接中断，正在自动重连（第 ${attempt + 1}/3 次）`,
            description: '刚才的进度已由服务端缓存，不会重复消耗识别次数',
          })
          setTimeout(() => {
            void startRef.current?.(force, attempt + 1)
          }, 1500)
          return
        }
        setPhase(file ? 'idle' : 'idle')
        toast({
          title: 'AI 识别失败',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      }
    },
    [file, handleEvent, reset, toast]
  )
  useEffect(() => {
    startRef.current = start
  }, [start])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const confirmImport = useCallback(async () => {
    if (preview.length === 0) return
    setPhase('importing')
    try {
      const r = await importQuestions(preview, file?.name ?? '')
      toast({
        title: `已导入 ${r.imported} 道题`,
        description: '可前往「题库」查看，或直接开始「复习」',
      })
      onImported()
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      reset()
    } catch (e) {
      setPhase('preview')
      toast({
        title: '导入失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    }
  }, [preview, file, onImported, reset, toast])

  const typeCounts = countByType(preview)
  const pct =
    progress.total > 0
      ? Math.round((Math.min(progress.current, progress.total) / progress.total) * 100)
      : phase === 'running'
        ? 8
        : 0

  return (
    <div className="space-y-4">
      {/* 上传区 */}
      <div
        className="rounded-xl border-2 border-dashed border-border bg-card p-6 text-center transition-colors hover:border-primary/50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f && !running) setFile(f)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.doc,.pdf,.txt,.md"
          className="hidden"
          id="import-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              setFile(f)
              reset()
            }
          }}
        />
        {!file ? (
          <label htmlFor="import-file-input" className="flex cursor-pointer flex-col items-center gap-2 py-4">
            <CloudUpload className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">点击选择或拖入题库文件</p>
            <p className="text-xs text-muted-foreground">支持 Word(.docx) / PDF / TXT，上限 30MB</p>
          </label>
        ) : (
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-8 w-8 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
            {!running && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="移除文件"
                onClick={() => {
                  setFile(null)
                  reset()
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2">
        {phase === 'idle' && file && (
          <Button onClick={() => void start(false)} className="min-h-11 flex-1 sm:flex-none" disabled={!file}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            开始 AI 识别
          </Button>
        )}
        {(phase === 'preview' || (phase === 'idle' && summary)) && (
          <>
            <Button onClick={() => void start(false)} variant="outline" className="min-h-11 flex-1 sm:flex-none">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              重新识别
            </Button>
            <Button
              onClick={() => void start(true)}
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              aria-label="忽略缓存强制重新识别"
            >
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden />
              强制重识（不用缓存）
            </Button>
          </>
        )}
        {phase === 'running' && (
          <Button onClick={cancel} variant="destructive" className="min-h-11 flex-1 sm:flex-none">
            <X className="mr-2 h-4 w-4" aria-hidden />
            取消识别
          </Button>
        )}
      </div>

      {/* 进度区 */}
      {(phase === 'running' || summary || stageMsg) && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            {phase === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            )}
            <span className="font-medium">{stageMsg || '等待开始'}</span>
            {found > 0 && (
              <Badge variant="secondary" className="ml-auto">
                已识别 {found} 题
              </Badge>
            )}
          </div>
          {progress.total > 0 && (
            <Progress value={pct} aria-label={`识别进度 ${pct}%`} />
          )}
          {warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {summary && (
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <Badge variant="outline">共 {summary.total} 题</Badge>
              <Badge variant="outline">有答案 {summary.answered}</Badge>
              {summary.supplement > 0 && (
                <Badge variant="outline">补扫找回 {summary.supplement}</Badge>
              )}
              {summary.filtered > 0 && (
                <Badge variant="outline">过滤无效 {summary.filtered}</Badge>
              )}
              {summary.failedChunks > 0 && (
                <Badge variant="destructive">失败片段 {summary.failedChunks}</Badge>
              )}
            </div>
          )}
        </div>
      )}

      {/* 预览区 */}
      {preview.length > 0 && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">识别结果预览</h3>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) =>
                typeCounts[t] ? (
                  <Badge key={t} variant="secondary">
                    {TYPE_LABELS[t]} {typeCounts[t]}
                  </Badge>
                ) : null
              )}
            </div>
          </div>
          <Separator />
          <ScrollArea className="max-h-none sm:max-h-96 sm:overflow-y-auto sm:pr-2">
            <ol className="space-y-3">
              {preview.map((q, i) => (
                <li key={i} className="rounded-lg border p-3 text-sm">
                  <p className="leading-relaxed">
                    <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {q.stem}
                  </p>
                  {q.options.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {q.options.map((o) => (
                        <li key={o.key}>
                          {o.key}. {o.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-xs">
                    <span className="text-muted-foreground">答案：</span>
                    <span className={q.answer ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}>
                      {q.answer || '（原文无答案）'}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          </ScrollArea>
          {phase === 'preview' && (
            <Button onClick={() => void confirmImport()} className="w-full min-h-11">
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
              确认导入 {preview.length} 道题
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function countByType(qs: ParsedQuestion[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const q of qs) m[q.type] = (m[q.type] ?? 0) + 1
  return m
}
