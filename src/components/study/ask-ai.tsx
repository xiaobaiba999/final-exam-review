'use client'

// 题目解析 + 追问面板：
// - 上半部分：解析展示 + 「AI 生成详细解析」（流式打字，成功后写回题库）
// - 下半部分：追问消息框（多轮对话，用户气泡右侧 / AI 气泡左侧，流式输出）
// - 对话记录随题目存 IndexedDB，导出迁移自动携带
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { Eraser, Loader2, MessageCircle, SendHorizontal, Sparkles } from 'lucide-react'
import { StoredQuestion, useQuestionStore } from '@/lib/question-store'
import { askFollowUp } from '@/lib/ask-ai'
import { explainOne } from '@/lib/explain'
import { ChatMsg } from '@/lib/types'

// ---------- 气泡 ----------
function ChatBubble({ msg, streaming = false }: { msg: ChatMsg; streaming?: boolean }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm border bg-card text-foreground'
        }`}
      >
        {msg.content}
        {streaming && (
          <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px] text-muted-foreground" aria-hidden />
        )}
      </div>
    </div>
  )
}

// ---------- 追问消息框 ----------
export function AskAiBox({ question }: { question: StoredQuestion }) {
  const { toast } = useToast()
  const appendChat = useQuestionStore((s) => s.appendChat)
  const clearChat = useQuestionStore((s) => s.clearChat)

  const chat = question.chat ?? []
  const [draft, setDraft] = useState('')
  const [streamText, setStreamText] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 新消息 / 流式更新时滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length, streamText])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setError(null)
    setSending(true)
    const userMsg: ChatMsg = { role: 'user', content: text, ts: Date.now() }
    appendChat(question.id, userMsg)
    const history = [...chat, userMsg]
    let acc = ''
    try {
      const full = await askFollowUp(question, history, text, (fullText) => {
        acc = fullText
        setStreamText(fullText)
      })
      appendChat(question.id, { role: 'assistant', content: full, ts: Date.now() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (acc) {
        // 已流式输出部分内容：保留已生成部分并标注中断
        appendChat(question.id, {
          role: 'assistant',
          content: `${acc}\n\n（回答中断：${msg}）`,
          ts: Date.now(),
        })
      } else {
        setError(msg)
        setDraft(text) // 未发出成功，还回输入框便于重发
        toast({ title: '追问发送失败', description: msg, variant: 'destructive' })
      }
    } finally {
      setStreamText(null)
      setSending(false)
    }
  }

  const clear = () => {
    if (sending) return
    clearChat(question.id)
    setError(null)
  }

  return (
    <div className="space-y-2 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          向 AI 追问本题
        </p>
        {chat.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={clear}
            disabled={sending}
            aria-label="清空本题对话"
          >
            <Eraser className="h-3 w-3" aria-hidden />
            清空对话
          </Button>
        )}
      </div>

      {(chat.length > 0 || streamText !== null) && (
        <div
          ref={scrollRef}
          className="max-h-72 space-y-2 overflow-y-auto rounded-lg bg-muted/30 p-2 [scrollbar-width:thin]"
          aria-label="追问对话记录"
        >
          {chat.map((m, i) => (
            <ChatBubble key={`${m.ts}-${i}`} msg={m} />
          ))}
          {streamText !== null && (
            <ChatBubble msg={{ role: 'assistant', content: streamText, ts: 0 }} streaming />
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送；输入法组词中的 Enter 不拦截
            if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="比如：为什么不选 B？这个考点能展开讲讲吗？"
          className="min-h-[44px] flex-1 resize-none py-2.5 text-sm"
          rows={1}
          aria-label="追问输入框"
          disabled={sending}
        />
        <Button
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={sending || !draft.trim()}
          onClick={() => void send()}
          aria-label="发送追问"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------- 解析 + 追问 整合面板 ----------
// 复习模式与题库详情共用：解析展示（缺时可流式生成）+ 追问消息框
export function ExplanationWithAsk({ question }: { question: StoredQuestion }) {
  const [genText, setGenText] = useState<string | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)

  const genExplanation = async () => {
    if (genBusy) return
    setGenBusy(true)
    setGenErr(null)
    setGenText('')
    try {
      const full = await explainOne(question, { onDelta: (fullText) => setGenText(fullText) })
      setGenText(full)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setGenErr(msg)
      setGenText(null) // 回退展示旧解析/占位
    } finally {
      setGenBusy(false)
    }
  }

  const showText = genText ?? question.explanation ?? ''

  return (
    <div className="space-y-2">
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">题目解析</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void genExplanation()}
            disabled={genBusy}
            aria-label={question.explanation ? 'AI 重新生成解析' : 'AI 生成详细解析'}
          >
            {genBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            )}
            {genBusy ? 'AI 生成中…' : question.explanation ? 'AI 重新生成' : 'AI 生成详细解析'}
          </Button>
        </div>
        {showText ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{showText}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {genErr ? `解析生成失败：${genErr}` : '暂无解析，点击右上角「AI 生成详细解析」试试'}
          </p>
        )}
      </div>
      <AskAiBox question={question} />
    </div>
  )
}
