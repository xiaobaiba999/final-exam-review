// 识别运行缓存（仅服务端，内存态）：
// 1) chunk 缓存：成功片段按内容指纹缓存，重跑只补失败片段
// 2) 整轮缓存：仅在「零失败」完整成功时写入，重试/回放直接复用
// 3) INFLIGHT：同文档进行中去重，新请求等待并回放事件流
import { createHash } from 'crypto'
import { AiStreamEvent } from './types'

const ROUND_TTL_MS = 30 * 60_000 // 整轮缓存 30 分钟
const CHUNK_TTL_MS = 60 * 60_000 // 片段缓存 1 小时
const MAX_ROUNDS = 8

export interface RoundCacheEntry {
  events: AiStreamEvent[] // 全量事件（含 done）
  total: number
  createdAt: number
}

interface ChunkEntry {
  questions: ParsedQuestionLike[]
  createdAt: number
}

// 避免循环依赖，这里用最小结构
export interface ParsedQuestionLike {
  type: string
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string
  explanation: string
}

const roundCache = new Map<string, RoundCacheEntry>()
const chunkCache = new Map<string, ChunkEntry>()
const inflight = new Map<string, RoundBroadcast>()

export function contentKey(fileName: string, buf: ArrayBuffer): string {
  const h = createHash('sha256')
  h.update(fileName)
  h.update(':')
  h.update(new Uint8Array(buf).slice(0, 512 * 1024))
  h.update(`:size=${buf.byteLength}`)
  return h.digest('hex').slice(0, 24)
}

export function chunkKey(runKey: string, text: string, kind: string): string {
  return createHash('sha256').update(`${runKey}|${kind}|${text}`).digest('hex').slice(0, 20)
}

// ---------- 整轮缓存 ----------
export function getRound(key: string): RoundCacheEntry | null {
  const e = roundCache.get(key)
  if (!e) return null
  if (Date.now() - e.createdAt > ROUND_TTL_MS) {
    roundCache.delete(key)
    return null
  }
  // 移到末尾，保持 LRU 语义
  roundCache.delete(key)
  roundCache.set(key, e)
  return e
}

// 仅在完整成功（failedChunks === 0）时调用
export function setRound(key: string, events: AiStreamEvent[], total: number) {
  while (roundCache.size >= MAX_ROUNDS) {
    const oldest = roundCache.keys().next().value
    if (oldest === undefined) break
    roundCache.delete(oldest)
  }
  roundCache.set(key, { events, total, createdAt: Date.now() })
}

export function dropRound(key: string) {
  roundCache.delete(key)
}

// ---------- 片段缓存 ----------
export function getChunk(key: string): ParsedQuestionLike[] | null {
  const e = chunkCache.get(key)
  if (!e) return null
  if (Date.now() - e.createdAt > CHUNK_TTL_MS) {
    chunkCache.delete(key)
    return null
  }
  return e.questions
}

export function setChunk(key: string, questions: ParsedQuestionLike[]) {
  if (chunkCache.size > 200) chunkCache.clear()
  chunkCache.set(key, { questions, createdAt: Date.now() })
}

// ---------- 进行中广播 ----------
// 同一文档正在识别时，新请求挂到同一广播上接收事件
export class RoundBroadcast {
  readonly key: string
  private buffers: Array<AiStreamEvent[]> = []
  private waiters: Array<(ev: AiStreamEvent | null) => void> = []
  private closed = false
  startedAt = Date.now()

  constructor(key: string) {
    this.key = key
  }

  push(ev: AiStreamEvent) {
    for (const b of this.buffers) b.push(ev)
    const ws = this.waiters.splice(0)
    for (const w of ws) w(ev)
  }

  // 订阅者读取：从 bufferIndex 读已有事件，之后等待新事件；closed 后返回 null
  async *subscribe(): AsyncGenerator<AiStreamEvent | null> {
    const buf: AiStreamEvent[] = []
    this.buffers.push(buf)
    let i = 0
    while (true) {
      if (i < buf.length) {
        yield buf[i++]
        continue
      }
      if (this.closed) {
        yield null
        return
      }
      const ev = await new Promise<AiStreamEvent | null>((resolve) => this.waiters.push(resolve))
      if (ev === null) {
        yield null
        return
      }
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    // 立即从进行中注册表移除：后续请求不再挂到已结束的广播上
    const idx = inflight.get(this.key)
    if (idx === this) inflight.delete(this.key)
    const ws = this.waiters.splice(0)
    for (const w of ws) w(null)
  }

  get isClosed(): boolean {
    return this.closed
  }

  get age(): number {
    return Date.now() - this.startedAt
  }
}

export function getInflight(key: string): RoundBroadcast | undefined {
  const b = inflight.get(key)
  if (!b) return undefined
  // 已关闭的广播不再对外：新请求应走全新识别或整轮缓存
  if (b.isClosed) {
    inflight.delete(key)
    return undefined
  }
  // 超过 10 分钟的残留广播视为僵死
  if (b.age > 600_000) {
    inflight.delete(key)
    return undefined
  }
  return b
}

export function registerInflight(key: string): RoundBroadcast {
  const b = new RoundBroadcast(key)
  inflight.set(key, b)
  return b
}
