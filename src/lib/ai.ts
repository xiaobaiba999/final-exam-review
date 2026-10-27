// LLM 调用层（浏览器直连版）：限流守卫 + 统一重试
// 架构说明：本应用无后端。AI 请求由浏览器直接发往硅基流动
// OpenAI 兼容接口（已验证支持 CORS），API Key 从设置 store 传入，
// 只存在于使用者自己的浏览器中，不经过任何第三方服务器。
// 保留与旧服务端版本一致的能力：429 指数退避守卫、串行排队、
// 网络错误重试、鉴权类错误快速失败。

// ---------- 限流守卫 ----------
// 429 后按 12s -> 24s -> 48s -> 60s 指数拉长全局等待窗口；
// 连续成功则逐级收缩恢复到常规间隔。
const RATE_PENALTY_STEPS = [12_000, 24_000, 48_000, 60_000]
// 相邻两次 LLM 请求的最小间隔（全局串行排队）
const NORMAL_GAP_MS = 1500
// gate() 附加的随机抖动，避免并发惊群
const JITTER_MS = 1200

interface RateGuard {
  gate(): Promise<void>
  hit(): void
  report(success: boolean): void
}

export function createRateGuard(): RateGuard {
  let penaltyIdx = 0
  let penaltyUntil = 0
  let lastStart = 0
  let chain: Promise<void> = Promise.resolve()

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  function gate(): Promise<void> {
    const task = chain.then(async () => {
      // 等待 429 惩罚窗口结束
      const waitPenalty = penaltyUntil - Date.now()
      if (waitPenalty > 0) await sleep(waitPenalty)
      // 常规节流间隔
      const waitGap = lastStart + NORMAL_GAP_MS - Date.now()
      if (waitGap > 0) await sleep(waitGap)
      // 抖动
      if (JITTER_MS > 0) await sleep(Math.floor(Math.random() * JITTER_MS))
      lastStart = Date.now()
    })
    // 队列容错：前一个任务失败不阻塞后续
    chain = task.catch(() => {})
    return task
  }

  function hit() {
    penaltyIdx = Math.min(penaltyIdx + 1, RATE_PENALTY_STEPS.length - 1)
    penaltyUntil = Math.max(penaltyUntil, Date.now() + RATE_PENALTY_STEPS[penaltyIdx])
  }

  function report(success: boolean) {
    if (success) {
      penaltyIdx = Math.max(0, penaltyIdx - 1)
      if (penaltyIdx === 0) penaltyUntil = 0
    }
  }

  return { gate, hit, report }
}

// ---------- 重试参数 ----------
const MAX_ATTEMPTS = 6
const PLAIN_BACKOFF_MS = [1_000, 4_000, 8_000]
export const LLM_TIMEOUT_MS = 150_000

const RATE_ERR_RE = /429|too many requests|rate ?limit|限流/i

// 鉴权/参数类错误：重试无意义，直接失败（如 Key 无效 401、模型不存在 404）
const AUTH_ERR_RE = /HTTP 40[134]|token is invalid|unauthorized|invalid api key|invalid token|model not found|不存在或无权限/i

export function isRateErr(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message}` : String(e ?? '')
  return RATE_ERR_RE.test(msg)
}

export function isAuthErr(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message}` : String(e ?? '')
  return AUTH_ERR_RE.test(msg)
}

// ---------- 连接配置 ----------
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatOptions {
  temperature?: number
  timeoutMs?: number
  guard?: RateGuard
  /** 硅基流动 API Key（必填，由 settings-store 提供） */
  apiKey: string
  /** 模型名，如 deepseek-ai/DeepSeek-V4.1-Flash */
  model: string
  /** OpenAI 兼容 Base URL */
  baseUrl?: string
}

// 硅基流动对话补全（OpenAI 兼容 /chat/completions），浏览器直连
async function sfChat(
  messages: ChatMessage[],
  opts: { apiKey: string; model: string; baseUrl: string },
  temperature: number,
  signal: AbortSignal
): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature,
        stream: false,
      }),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('LLM 请求超时')
    throw new Error(`无法连接 AI 服务：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    // 错误信息中带上状态码，便于 isRateErr 识别 429 触发限流守卫
    throw new Error(`AI 服务 HTTP ${res.status}：${body || res.statusText}`)
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  } | null
  const msg = data?.choices?.[0]?.message
  const text = String(msg?.content ?? '').trim() || String(msg?.reasoning_content ?? '').trim()
  if (!text) throw new Error('LLM 返回空内容')
  return text
}

// 流式对话补全（OpenAI 兼容 SSE），浏览器直连；onDelta 每次回调当前累计全文
async function sfChatStream(
  messages: ChatMessage[],
  opts: { apiKey: string; model: string; baseUrl: string },
  temperature: number,
  signal: AbortSignal,
  onDelta: (full: string, delta: string) => void
): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature,
        stream: true,
      }),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('LLM 请求超时')
    throw new Error(`无法连接 AI 服务：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`AI 服务 HTTP ${res.status}：${body || res.statusText}`)
  }
  if (!res.body) throw new Error('AI 服务未返回数据流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let acc = ''
  let reasoning = ''
  let streamDone = false
  while (!streamDone) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') {
        streamDone = true
        break
      }
      try {
        const obj = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
        }
        const d = obj.choices?.[0]?.delta
        const piece = String(d?.content ?? '')
        if (piece) {
          acc += piece
          onDelta(acc, piece)
        } else {
          reasoning += String(d?.reasoning_content ?? '')
        }
      } catch {
        /* 忽略无法解析的心跳/杂项行 */
      }
    }
  }
  const text = acc.trim() || reasoning.trim()
  if (!text) throw new Error('LLM 返回空内容')
  return text
}

// 带限流守卫与重试的对话补全，返回文本内容；失败抛错
export async function chatSafe(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const guard = opts.guard
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS
  const temperature = opts.temperature ?? 0
  const baseUrl = (opts.baseUrl ?? 'https://api.siliconflow.cn/v1').trim()
  let plainErrCount = 0
  while (true) {
    if (guard) await guard.gate()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const text = await sfChat(
        messages,
        { apiKey: opts.apiKey, model: opts.model, baseUrl },
        temperature,
        controller.signal
      )
      guard?.report(true)
      return text
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      if (isRateErr(err)) {
        guard?.hit()
        continue // 惩罚窗口由 gate() 兜住，不计入普通退避
      }
      if (isAuthErr(err)) {
        throw err // Key 无效/模型不存在等：重试无意义，立即失败
      }
      const backoff = PLAIN_BACKOFF_MS[Math.min(plainErrCount, PLAIN_BACKOFF_MS.length - 1)]
      plainErrCount++
      if (plainErrCount >= MAX_ATTEMPTS) throw err
      await new Promise<void>((r) => setTimeout(r, backoff))
    } finally {
      clearTimeout(timer)
    }
  }
}

// 带限流守卫与重试的流式对话补全。
// 重试策略：尚未向用户输出任何内容时才允许重试（429 走守卫惩罚窗口）；
// 已经流式输出过部分内容则直接抛错，避免重复输出，由调用方保留已生成部分。
export async function chatSafeStream(
  messages: ChatMessage[],
  opts: ChatOptions,
  onDelta: (full: string, delta: string) => void
): Promise<string> {
  const guard = opts.guard
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS
  const temperature = opts.temperature ?? 0
  const baseUrl = (opts.baseUrl ?? 'https://api.siliconflow.cn/v1').trim()
  let plainErrCount = 0
  while (true) {
    if (guard) await guard.gate()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let received = false
    try {
      const text = await sfChatStream(
        messages,
        { apiKey: opts.apiKey, model: opts.model, baseUrl },
        temperature,
        controller.signal,
        (full, delta) => {
          received = true
          onDelta(full, delta)
        }
      )
      guard?.report(true)
      return text
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      if (isRateErr(err)) {
        guard?.hit()
        if (!received) continue // 惩罚窗口由 gate() 兑住，不计入普通退避
        throw err
      }
      if (isAuthErr(err)) {
        throw err // Key 无效/模型不存在等：重试无意义，立即失败
      }
      if (received) throw err // 已输出部分内容，重试会导致重复
      const backoff = PLAIN_BACKOFF_MS[Math.min(plainErrCount, PLAIN_BACKOFF_MS.length - 1)]
      plainErrCount++
      if (plainErrCount >= MAX_ATTEMPTS) throw err
      await new Promise<void>((r) => setTimeout(r, backoff))
    } finally {
      clearTimeout(timer)
    }
  }
}

// 从 LLM 回复中稳健地解析 JSON（容忍 ```json 围栏与前后杂文本）
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const startArr = text.indexOf('[')
  const useArr = startArr !== -1 && (start === -1 || startArr < start)
  const s = useArr ? startArr : start
  if (s === -1) return null
  const endObj = text.lastIndexOf('}')
  const endArr = text.lastIndexOf(']')
  const e = useArr ? endArr : Math.max(endObj, endArr)
  if (e <= s) return null
  try {
    return JSON.parse(text.slice(s, e + 1)) as T
  } catch {
    return null
  }
}
