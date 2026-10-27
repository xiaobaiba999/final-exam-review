// 前端 API 客户端：SSE 读取 + 断线自动重连
// 安全约定：本文件不涉及任何 API Key；Key 仅保存在部署平台环境变量中，前端不可见
'use client'

import { AiStreamEvent } from './types'

export type AiStreamError = Error & { transient?: boolean }

function transientError(message: string): AiStreamError {
  const e = new Error(message) as AiStreamError
  e.transient = true
  return e
}

const TRANSIENT_STREAM_ERRORS = /限流紧张|同时进行的相同识别|等待进行中的同文档|连接中断/

export interface RunAiStreamHandlers {
  onEvent: (ev: AiStreamEvent) => void
}

export interface RunAiStreamOptions {
  signal?: AbortSignal
}

// 上传文件并消费识别事件流。
// 抛出的错误带 transient 标记时调用方可自动重连（服务端会回放缓存进度）。
export async function runAiStream(
  input: { file: File; force?: boolean },
  handlers: RunAiStreamHandlers,
  attempt = 0,
  options: RunAiStreamOptions = {}
): Promise<void> {
  const form = new FormData()
  form.append('file', input.file)
  if (input.force) form.append('force', '1')

  let res: Response
  try {
    res = await fetch('/api/parse-ai-stream', {
      method: 'POST',
      body: form,
      signal: options.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw transientError('网络连接失败，正在自动重连…')
  }

  if (!res.ok || !res.body) {
    let msg = `识别服务响应异常（${res.status}）`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    const e = new Error(msg) as AiStreamError
    e.transient = res.status >= 500 || res.status === 429
    throw e
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue
        try {
          const ev = JSON.parse(line.slice(5).trim()) as AiStreamEvent
          if (ev.type === 'done') sawDone = true
          handlers.onEvent(ev)
        } catch {
          /* 跳过坏帧 */
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw transientError('AI 识别连接中断，正在自动重连，刚才的进度已缓存…')
  }

  if (!sawDone) {
    throw transientError('识别流提前结束，正在自动重连…')
  }
}

export function isTransient(e: unknown): boolean {
  if (e instanceof Error) {
    if ((e as AiStreamError).transient) return true
    return TRANSIENT_STREAM_ERRORS.test(e.message)
  }
  return false
}

export function shouldReconnect(e: unknown, attempt: number): boolean {
  // 上限 3 次：云平台函数有时长限制时，断线重连 + 服务端片段缓存可无缝续跑
  return attempt < 3 && isTransient(e)
}

// ---------- 普通接口 ----------
export interface StoredQuestion {
  id: string
  type: string
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string
  explanation: string
  source: string
  createdAt: string
  /** 已收藏 */
  starred: boolean
  /** 在错题本中（答错自动进入，答对自动移出） */
  wrong: boolean
  /** 累计答对次数 */
  rightCount: number
  /** 累计答错次数 */
  wrongCount: number
}

export async function fetchQuestions(): Promise<StoredQuestion[]> {
  const res = await fetch('/api/questions')
  if (!res.ok) throw new Error('题库加载失败')
  const data = (await res.json()) as { questions: StoredQuestion[] }
  return data.questions
}

export async function importQuestions(questions: AiStreamEventQuestionsInput, source: string) {
  const res = await fetch('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions, source }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error ?? '导入失败')
  }
  return (await res.json()) as { imported: number }
}

type AiStreamEventQuestionsInput = Array<{
  type: string
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string
  explanation: string
}>

export async function deleteQuestion(id: string) {
  const res = await fetch(`/api/questions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除失败')
}

export async function clearQuestions() {
  const res = await fetch('/api/questions?all=1', { method: 'DELETE' })
  if (!res.ok) throw new Error('清空失败')
}

// 题目状态变更：收藏 / 答错入本 / 答对出本（服务端维护计数）
export type QuestionAction = 'star' | 'unstar' | 'markWrong' | 'markRight' | 'removeWrong'

export interface PatchResult {
  starred: boolean
  wrong: boolean
  rightCount: number
  wrongCount: number
}

export async function patchQuestion(id: string, action: QuestionAction): Promise<PatchResult> {
  const res = await fetch('/api/questions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action }),
  })
  if (!res.ok) throw new Error('操作失败，请重试')
  return (await res.json()) as PatchResult
}

export async function runExplain(limit = 8): Promise<{ updated: number; remaining: number }> {
  const res = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
  if (!res.ok) throw new Error('解析生成失败')
  return (await res.json()) as { updated: number; remaining: number }
}
