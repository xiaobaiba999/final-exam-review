// 识别运行缓存（浏览器版，localStorage 持久）：
// 1) 片段缓存：成功片段按内容指纹缓存，刷新页面后重试只补失败片段（不重复消耗 Key 额度）
// 2) 整轮缓存：仅在「零失败」完整成功时写入，重试直接复用完整结果
// 说明：无后端后不再需要 SSE 事件流回放与跨请求 INFLIGHT 广播，
// 同文档并发去重在 parse-ai 管线内以简单的模块级 Promise 完成。
'use client'

import { AiStreamEvent, ParsedQuestion } from './types'
import { userScopedKey } from './user-store'

const ROUND_TTL_MS = 30 * 60_000 // 整轮缓存 30 分钟
const CHUNK_TTL_MS = 60 * 60_000 // 片段缓存 1 小时
const MAX_ROUNDS = 6
const CACHE_PREFIX = 'exam-review-parse:'
// localStorage 缓存软上限（字符数），超出后清理最旧条目
const CACHE_CHAR_BUDGET = 1_500_000

export interface RoundCacheEntry {
  /** 最终题目（去重/补扫/答案回填后） */
  questions: ParsedQuestion[]
  fileName: string
  createdAt: number
}

interface ChunkEntry {
  questions: ParsedQuestion[]
  createdAt: number
}

// ---------- 哈希（Web Crypto，异步） ----------
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function contentKey(fileName: string, buf: ArrayBuffer): Promise<string> {
  // 采样前 512KB + 文件大小，超长文档不整段哈希（内存/耗时考虑）
  const head = new Uint8Array(buf.slice(0, 512 * 1024))
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < head.length; i += CHUNK) {
    binary += String.fromCharCode(...head.subarray(i, i + CHUNK))
  }
  const h = await sha256Hex(`${fileName}:${binary}:size=${buf.byteLength}`)
  return h.slice(0, 24)
}

export async function chunkKey(runKey: string, text: string, kind: string): Promise<string> {
  const h = await sha256Hex(`${runKey}|${kind}|${text}`)
  return h.slice(0, 20)
}

// 当前用户的缓存前缀（切换用户会刷新页面，页内一致）
function scopedPrefix(): string {
  return userScopedKey(CACHE_PREFIX)
}

// ---------- localStorage 读写 ----------
function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(scopedPrefix() + key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(scopedPrefix() + key, JSON.stringify(value))
  } catch {
    // 配额不足等异常：清掉自己的缓存再试一次，仍失败则放弃缓存（不影响主流程）
    try {
      clearAll()
      localStorage.setItem(scopedPrefix() + key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(scopedPrefix() + key)
  } catch {
    /* ignore */
  }
}

function listKeys(prefix: string): string[] {
  const out: string[] = []
  const full = scopedPrefix()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(full + prefix)) out.push(k.slice(full.length))
    }
  } catch {
    /* ignore */
  }
  return out
}

function clearAll(): void {
  try {
    const full = scopedPrefix()
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(full)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

// ---------- 整轮缓存 ----------
export function getRound(key: string): RoundCacheEntry | null {
  const e = readJSON<RoundCacheEntry>(`round:${key}`)
  if (!e || !Array.isArray(e.questions)) return null
  if (Date.now() - e.createdAt > ROUND_TTL_MS) {
    removeKey(`round:${key}`)
    return null
  }
  return e
}

// 仅在完整成功（failedChunks === 0）时调用
export function setRound(key: string, questions: ParsedQuestion[], fileName: string): void {
  const keys = listKeys('round:')
  // LRU：按 createdAt 清最旧
  const entries = keys
    .map((k) => ({ k, e: readJSON<RoundCacheEntry>(k) }))
    .filter((x): x is { k: string; e: RoundCacheEntry } => x.e !== null)
    .sort((a, b) => a.e.createdAt - b.e.createdAt)
  while (entries.length >= MAX_ROUNDS) {
    const oldest = entries.shift()
    if (!oldest) break
    removeKey(oldest.k)
  }
  writeJSON(`round:${key}`, { questions, fileName, createdAt: Date.now() })
}

export function dropRound(key: string): void {
  removeKey(`round:${key}`)
}

// ---------- 片段缓存 ----------
export function getChunk(key: string): ParsedQuestion[] | null {
  const e = readJSON<ChunkEntry>(`chunk:${key}`)
  if (!e || !Array.isArray(e.questions)) return null
  if (Date.now() - e.createdAt > CHUNK_TTL_MS) {
    removeKey(`chunk:${key}`)
    return null
  }
  return e.questions
}

export function setChunk(key: string, questions: ParsedQuestion[]): void {
  // 空片段不缓存（无意义且占空间）
  if (questions.length === 0) return
  writeJSON(`chunk:${key}`, { questions, createdAt: Date.now() })
  enforceBudget()
}

// 缓存总量预算控制：超出后按时间清最旧
function enforceBudget(): void {
  try {
    let total = 0
    const items: Array<{ k: string; size: number; createdAt: number }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(scopedPrefix())) continue
      const v = localStorage.getItem(k) ?? ''
      total += k.length + v.length
      let createdAt = 0
      try {
        createdAt = (JSON.parse(v) as { createdAt?: number }).createdAt ?? 0
      } catch {
        /* ignore */
      }
      items.push({ k, size: k.length + v.length, createdAt })
    }
    if (total <= CACHE_CHAR_BUDGET) return
    items.sort((a, b) => a.createdAt - b.createdAt)
    for (const it of items) {
      if (total <= CACHE_CHAR_BUDGET) break
      localStorage.removeItem(it.k)
      total -= it.size
    }
  } catch {
    /* ignore */
  }
}

// 供设置页展示/清理
export function parseCacheStats(): { rounds: number; chunks: number; bytes: number } {
  const rounds = listKeys('round:').length
  const chunks = listKeys('chunk:').length
  let bytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(scopedPrefix())) bytes += k.length + (localStorage.getItem(k)?.length ?? 0)
    }
  } catch {
    /* ignore */
  }
  return { rounds, chunks, bytes }
}

export function clearParseCache(): void {
  clearAll()
}
