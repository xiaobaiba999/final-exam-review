// LLM 调用层：限流守卫 + 统一重试 + 多供应商
// 全部仅在服务端使用
//
// 供应商解析：
//   1. 环境变量 SILICONFLOW_API_KEY（在部署平台 Secrets 中配置，不进代码仓库，前端不可见）
//   2. 内置 SDK 回退（仅沙箱开发调试用；生产部署无 Key 时会给出明确提示）
// 安全约定：前端 UI 不提供任何 Key 输入入口，Key 永不经过浏览器
import ZAI from 'z-ai-web-dev-sdk'

// 硅基流动（SiliconFlow）OpenAI 兼容接口
const SF_BASE_URL = (process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1').replace(/\/$/, '')
// 默认模型：用户指定的 DeepSeek（可通过 SILICONFLOW_MODEL 环境变量覆盖）
export const DEFAULT_SF_MODEL = process.env.SILICONFLOW_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash'

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

// ---------- LLM 客户端 ----------
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

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null

function getZAI() {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise
}

// ---------- 供应商解析 ----------
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatOptions {
  temperature?: number
  timeoutMs?: number
  guard?: RateGuard
}

interface SfCredential {
  kind: 'siliconflow'
  apiKey: string
  model: string
}

// 解析本次调用应使用的供应商：环境变量 > 内置回退
function resolveCredential(_opts: ChatOptions): SfCredential | { kind: 'builtin' } {
  const key = (process.env.SILICONFLOW_API_KEY ?? '').trim()
  if (key) {
    return {
      kind: 'siliconflow',
      apiKey: key,
      model: DEFAULT_SF_MODEL,
    }
  }
  return { kind: 'builtin' }
}

// 当前 AI 服务状态（供 /api/ai-status 展示，不发起真实请求）
export function getLlmStatus() {
  const env = (process.env.SILICONFLOW_API_KEY ?? '').trim()
  return {
    provider: env ? 'siliconflow' : 'builtin',
    model: env ? DEFAULT_SF_MODEL : 'glm-4-plus（内置）',
    source: env ? 'env' : 'builtin',
    envKeySet: env.length > 0,
  }
}

// 硅基流动对话补全（OpenAI 兼容 /chat/completions）
async function sfChat(
  messages: ChatMessage[],
  cred: SfCredential,
  temperature: number,
  signal: AbortSignal
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${SF_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify({
        model: cred.model,
        messages,
        temperature,
        stream: false,
      }),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('LLM 请求超时')
    throw new Error(`无法连接硅基流动服务：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    // 错误信息中带上状态码，便于 isRateErr 识别 429 触发限流守卫
    throw new Error(`硅基流动 HTTP ${res.status}：${body || res.statusText}`)
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  } | null
  const msg = data?.choices?.[0]?.message
  const text = String(msg?.content ?? '').trim() || String(msg?.reasoning_content ?? '').trim()
  if (!text) throw new Error('LLM 返回空内容')
  return text
}

// 内置 SDK 对话补全（沙箱网关；生产环境无网关时会给出可操作的错误提示）
async function builtinChat(messages: ChatMessage[], temperature: number): Promise<string> {
  try {
    const zai = await getZAI()
    const res = (await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
      temperature,
    })) as { choices?: Array<{ message?: { content?: string } }> }
    const text = res?.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('LLM 返回空内容')
    return text
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    throw new Error(
      `内置 AI 服务不可用（${err.message}）。请在部署平台（Vercel/服务器）的环境变量中配置 SILICONFLOW_API_KEY 后重新部署`
    )
  }
}

// 带限流守卫与重试的对话补全，返回文本内容；失败抛错
export async function chatSafe(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const guard = opts.guard
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS
  const temperature = opts.temperature ?? 0
  let plainErrCount = 0
  while (true) {
    if (guard) await guard.gate()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const cred = resolveCredential(opts)
      const text =
        cred.kind === 'siliconflow'
          ? await sfChat(messages, cred, temperature, controller.signal)
          : await builtinChat(messages, temperature)
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
