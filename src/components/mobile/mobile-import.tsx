'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ClipboardPaste,
  FileUp,
  Loader2,
  PencilLine,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import {
  createBank,
  parseText,
  parseWithAiStream,
  type AiStreamEvent,
} from '@/lib/api-client'
import {
  MAX_FILE_SIZE,
  QUESTION_TYPE_LABEL,
  SUPPORTED_EXTS,
  type ParseResult,
  type ParsedQuestion,
} from '@/lib/types'
import { SAMPLE_MESSY_TEXT } from '@/lib/sample'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { QuestionEditDialog, type EditableQuestion } from '@/components/study/question-edit-dialog'
import { QuestionTypeBadge } from '@/components/study/question-type-badge'
import { AiStreamPanel, type AiStreamState } from '@/components/study/ai-stream-panel'

type Step = 'source' | 'preview'

const INITIAL_STREAM: AiStreamState = {
  phase: { percent: 0, message: '准备启动 AI 识别 Agent…' },
  meta: null,
  live: [],
  notes: [],
  elapsed: 0,
}

function suggestName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base || `题库 ${new Date().toLocaleDateString('zh-CN')}`
}

/** 移动端导入：上传/粘贴 → AI 流式识别（实时进度）→ 预览编辑 → 保存 */
export function MobileImport() {
  const setView = useAppStore((s) => s.setView)
  const refreshBanks = useAppStore((s) => s.refreshBanks)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('source')
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const [questions, setQuestions] = useState<ParsedQuestion[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [bankName, setBankName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [editInitial, setEditInitial] = useState<EditableQuestion | null>(null)
  const [stream, setStream] = useState<AiStreamState>(INITIAL_STREAM)
  // 双轨：ref 做同步防重入，state 驱动渲染（面板在选择文件后立即出现）
  const [aiRunning, setAiRunning] = useState(false)
  const aiRunningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // 组件卸载时中止进行中的识别请求（服务端会继续跑完并缓存结果）
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  /** 统一处理解析结果 */
  const applyResult = (r: ParseResult) => {
    setRawText(r.text)
    setFileName(r.fileName)
    setQuestions(r.questions)
    setNotices(r.notices)
    setBankName(suggestName(r.fileName))
    setStep('preview')
  }

  // ---------------- AI 流式识别 ----------------
  const runAiStream = async (
    input: { file?: File; text?: string; fileName?: string },
    attempt = 0,
  ) => {
    if (aiRunningRef.current) return
    aiRunningRef.current = true
    setAiRunning(true)
    setStream(INITIAL_STREAM)
    const controller = new AbortController()
    abortRef.current = controller
    const timer = window.setInterval(() => {
      setStream((s) => ({ ...s, elapsed: s.elapsed + 1 }))
    }, 1000)

    const notes: string[] = []
    let finished = false

    try {
      await parseWithAiStream(
        input,
        (e: AiStreamEvent) => {
          switch (e.type) {
            case 'stage':
              setStream((s) => ({ ...s, phase: { percent: e.percent, message: e.message } }))
              break
            case 'meta':
              setStream((s) => ({
                ...s,
                meta: {
                  chunkTotal: e.chunkTotal,
                  chunkDone: 0,
                  hasAnswerKey: e.hasAnswerKey,
                  chars: e.chars,
                  sections: e.sections,
                },
                phase: { percent: 6, message: `结构分析完成：${e.sectionCount} 个章节、${e.chunkTotal} 段` },
              }))
              break
            case 'progress':
              setStream((s) => ({
                ...s,
                phase: { percent: e.percent, message: e.message },
                meta: s.meta ? { ...s.meta, chunkDone: e.chunkDone } : s.meta,
              }))
              break
            case 'questions':
              setStream((s) => ({
                ...s,
                live: [...s.live, ...e.questions],
                phase: { percent: e.percent, message: `已识别 ${e.total} 题` },
                meta: s.meta ? { ...s.meta, chunkDone: e.chunkDone } : s.meta,
              }))
              break
            case 'warning':
              if (!notes.includes(e.message)) notes.push(e.message)
              setStream((s) => ({ ...s, notes: [...notes] }))
              break
            case 'done': {
              finished = true
              if (e.questions.length === 0) {
                toast({
                  title: 'AI 未能识别出题目',
                  description: '请检查文档内容，或手动粘贴文本后重试',
                  variant: 'destructive',
                })
              } else {
                applyResult({
                  text: e.text,
                  fileName: e.fileName,
                  questions: e.questions,
                  notices: e.notices,
                  stats: { chars: e.chars, lines: e.text.split('\n').length },
                })
                toast({
                  title: `AI 识别完成：${e.total} 道题`,
                  description: e.answered > 0 ? `其中 ${e.answered} 题已自动匹配答案` : '部分题目缺答案，可稍后补充',
                })
              }
              break
            }
          }
        },
        controller.signal,
      )
    } catch (err) {
      const transient = (err as { transient?: boolean } | null)?.transient === true
      if (!finished && transient && attempt < 2) {
        // 断线/限流等待死路等瞬时失败：自动重连（服务端已缓存进度，重试秒级回放或只补缺失片段）
        toast({
          title: `连接中断，正在自动重连（第 ${attempt + 1}/2 次）…`,
          description: '已识别的进度已保存，无需重新等待',
        })
        window.setTimeout(() => {
          void runAiStream(input, attempt + 1)
        }, 1500)
      } else if (!finished && (err as Error)?.name !== 'AbortError') {
        toast({
          title: 'AI 识别失败',
          description: err instanceof Error ? err.message : '请稍后重试',
          variant: 'destructive',
        })
      }
    } finally {
      window.clearInterval(timer)
      abortRef.current = null
      aiRunningRef.current = false
      setAiRunning(false)
      setStream(INITIAL_STREAM)
    }
  }

  const cancelAiStream = () => {
    abortRef.current?.abort()
  }

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!(SUPPORTED_EXTS as readonly string[]).includes(ext)) {
      toast({ title: '不支持的文件格式', description: '请上传 Word（.docx/.doc）、PDF 或 TXT 文件', variant: 'destructive' })
      return false
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: '文件过大', description: '请上传 30MB 以内的文件', variant: 'destructive' })
      return false
    }
    return true
  }

  /** 上传文件 → 直接交给 AI 识别 Agent（流式进度） */
  const handleFile = (file: File) => {
    if (!validateFile(file)) return
    void runAiStream({ file })
  }

  /** 粘贴文本快速路径（规则解析） */
  const parseFromText = async (text: string, sourceName: string) => {
    if (!text.trim()) {
      toast({ title: '请先粘贴题目文本', variant: 'destructive' })
      return
    }
    setParsing(true)
    try {
      const r = await parseText(text)
      applyResult({ ...r, fileName: sourceName })
      toast({ title: `识别到 ${r.questions.length} 道题`, description: '请在下方核对编辑后保存' })
    } catch (e) {
      toast({
        title: '文本解析失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setParsing(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const name = bankName.trim() || suggestName(fileName)
    if (questions.length === 0) {
      toast({ title: '没有可保存的题目', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const { id, total } = await createBank({ name, source: fileName || null, questions })
      toast({ title: '题库已保存', description: `「${name}」共 ${total} 道题，开始复习吧！` })
      refreshBanks()
      setView('banks')
      void id
      // 重置向导
      setStep('source')
      setPasteMode(false)
      setPasteText('')
      setQuestions([])
      setNotices([])
      setRawText('')
      setFileName('')
      setBankName('')
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (index: number) => {
    const q = questions[index]
    if (!q) return
    setEditIndex(index)
    setEditInitial({
      type: q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation ?? '',
    })
  }

  const handleEditSave = (data: EditableQuestion) => {
    if (editIndex === null) return
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === editIndex
          ? { ...q, ...data, explanation: data.explanation || undefined }
          : q,
      ),
    )
    setEditIndex(null)
    setEditInitial(null)
    toast({ title: '已更新题目' })
  }

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index))
  }

  // ---------------- AI 运行中：流式进度面板 ----------------
  if (aiRunning) {
    return (
      <section className="animate-in fade-in px-3 pb-28 pt-4 duration-300">
        <AiStreamPanel state={stream} onCancel={cancelAiStream} />
      </section>
    )
  }

  // ---------------- 普通解析中：简易遮罩 ----------------
  if (parsing) {
    return (
      <section className="flex flex-col items-center justify-center gap-4 px-6 pb-28 pt-32 text-center">
        <Loader2 className="size-10 animate-spin text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-base font-semibold">正在识别题目…</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
            规则解析器正在处理文本，通常几秒内完成
          </p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="导入题库" className="animate-in fade-in px-4 pb-28 pt-4 duration-300">
      <div className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">导入题库</h2>
        <p className="mt-0.5 text-xs text-stone-500 dark:text-zinc-400">
          AI 识别 Agent 自动分章解析、匹配文末答案，实时显示进度
        </p>
      </div>

      {/* ---------------- 第一步：选择来源 ---------------- */}
      {step === 'source' && (
        <div className="space-y-3">
          {/* 上传文件 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-4 rounded-2xl border border-stone-200/80 bg-white p-5 text-left shadow-sm transition-colors active:bg-emerald-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-emerald-950/20"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <FileUp className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">上传文件（AI 识别）</span>
              <span className="mt-0.5 block text-xs text-stone-500 dark:text-zinc-400">
                Word / PDF / TXT，30MB 以内 · 流式进度实时可见
              </span>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.doc,.pdf,.txt"
            className="hidden"
            aria-label="选择题库文件"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) handleFile(f)
            }}
          />

          {/* 粘贴文本 */}
          <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              className="flex w-full items-center gap-4 text-left"
              onClick={() => setPasteMode((v) => !v)}
              aria-expanded={pasteMode}
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400">
                <ClipboardPaste className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">粘贴文本</span>
                <span className="mt-0.5 block text-xs text-stone-500 dark:text-zinc-400">
                  从微信 / 网页复制题目，AI 流式识别
                </span>
              </span>
            </button>
            {pasteMode && (
              <div className="mt-4 space-y-3">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'在此粘贴题目文本，例如：\n1. 下列哪个是…\nA. 选项一\nB. 选项二\n答案：A'}
                  className="min-h-44 text-sm"
                  aria-label="粘贴题目文本"
                />
                <div className="flex gap-2">
                  <Button
                    className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() =>
                      void runAiStream({
                        text: pasteText,
                        fileName: `粘贴题库 ${new Date().toLocaleDateString('zh-CN')}`,
                      })
                    }
                    disabled={!pasteText.trim()}
                  >
                    <Sparkles className="size-4" />
                    AI 流式识别
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 border-stone-300 dark:border-zinc-700"
                    onClick={() => void parseFromText(pasteText, `粘贴题库 ${new Date().toLocaleDateString('zh-CN')}`)}
                    disabled={!pasteText.trim()}
                  >
                    快速识别
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-full text-stone-400"
                  onClick={() => {
                    setPasteText(SAMPLE_MESSY_TEXT)
                    toast({ title: '示例已填充', description: '点击「AI 流式识别」体验效果' })
                  }}
                >
                  填充示例
                </Button>
              </div>
            )}
          </div>

          {/* 提示 */}
          <div className="rounded-xl bg-stone-100/80 px-4 py-3 text-xs leading-relaxed text-stone-500 dark:bg-zinc-900/60 dark:text-zinc-400">
            💡 文档格式再乱也不怕：AI Agent 按章节分段识别、自动匹配文末参考答案，每段完成立即推送进度。
          </div>
        </div>
      )}

      {/* ---------------- 第二步：预览与保存 ---------------- */}
      {step === 'preview' && (
        <div className="space-y-4 pb-24">
          {/* 返回 + 概览 */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-10 px-2 text-stone-600 dark:text-zinc-300"
              onClick={() => setStep('source')}
            >
              <ChevronLeft className="size-4" />
              重新选择
            </Button>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              已识别 {questions.length} 题
            </span>
          </div>

          {/* 全局警告 */}
          {notices.length > 0 && (
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              role="alert"
            >
              <p className="mb-1 flex items-center gap-1 font-semibold">
                <TriangleAlert className="size-3.5" />
                解析提示
              </p>
              {notices.map((n, i) => (
                <p key={i}>· {n}</p>
              ))}
            </div>
          )}

          {/* 题库命名 */}
          <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <label htmlFor="mobile-bank-name" className="mb-2 block text-sm font-medium text-stone-700 dark:text-zinc-200">
              题库名称
            </label>
            <Input
              id="mobile-bank-name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="给题库起个名字"
              className="h-11"
            />
          </div>

          {/* AI 重新识别 */}
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="flex items-center gap-3">
              <Sparkles className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-800 dark:text-zinc-100">识别结果不理想？</p>
                <p className="mt-0.5 text-xs text-stone-500 dark:text-zinc-400">
                  AI 识别 Agent 将重新流式解析原文并覆盖当前结果
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-3 h-11 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
              onClick={() =>
                void runAiStream({ text: rawText, fileName: fileName || '粘贴文本' })
              }
            >
              <Sparkles className="size-4" />
              AI 智能识别重新解析
            </Button>
          </div>

          {/* 题目列表 */}
          {questions.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-stone-300 px-6 py-10 text-center dark:border-zinc-700">
              <p className="text-sm text-stone-500 dark:text-zinc-400">
                没有识别到题目，试试「AI 智能识别」或返回重新选择来源
              </p>
            </div>
          ) : (
            <ol className="space-y-2.5">
              {questions.map((q, i) => (
                <li
                  key={`${i}-${q.stem.slice(0, 12)}`}
                  className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-semibold tabular-nums text-stone-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openEdit(i)}
                      aria-label={`编辑第 ${i + 1} 题`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <QuestionTypeBadge type={q.type} className="text-[10px]">
                          {QUESTION_TYPE_LABEL[q.type]}
                        </QuestionTypeBadge>
                        {!q.answer && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">未识别到答案</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-stone-800 dark:text-zinc-100">
                        {q.stem}
                      </p>
                      {q.warnings && q.warnings.length > 0 && (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{q.warnings[0]}</p>
                      )}
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-stone-400 hover:text-emerald-600"
                        onClick={() => openEdit(i)}
                        aria-label={`编辑第 ${i + 1} 题`}
                      >
                        <PencilLine className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-stone-400 hover:text-red-600"
                        onClick={() => removeQuestion(i)}
                        aria-label={`删除第 ${i + 1} 题`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* 吸底保存栏（位于底部 Tab 导航上方） */}
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-stone-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            <Button
              className={cn('h-12 w-full bg-emerald-600 text-base text-white shadow-sm hover:bg-emerald-700')}
              onClick={() => void handleSave()}
              disabled={saving || questions.length === 0}
            >
              {saving ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <Save className="size-5" />
                  保存入库（{questions.length} 题）
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* 编辑题目对话框 */}
      <QuestionEditDialog
        open={editIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditIndex(null)
            setEditInitial(null)
          }
        }}
        title={`编辑第 ${(editIndex ?? 0) + 1} 题`}
        initial={editInitial}
        onSave={handleEditSave}
      />
    </section>
  )
}
