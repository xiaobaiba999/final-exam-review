// 本地多用户系统（无后端版）：
// - 每个用户注册一个「昵称 + 可选密码」的本地账号
// - 题库/进度/设置按用户名隔离存储（IndexedDB / localStorage 键名加前缀）
// - 账号与密码哈希只保存在本机浏览器；换设备用「设置 → 导出/导入文件」迁移
// 安全说明：这是本机数据隔离与便捷锁，不是服务端级别的账号安全
'use client'

import { create } from 'zustand'

const REGISTRY_KEY = 'exam-review-users'
const SESSION_KEY = 'exam-review-session'

export interface UserProfile {
  name: string
  /** SHA-256(name::pass) 十六进制；空字符串 = 未设密码 */
  passHash: string
  createdAt: number
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashPassword(name: string, pass: string): Promise<string> {
  return sha256Hex(`exam-review::${name}::${pass}`)
}

// ---------- 同步读取（供各 store 在模块初始化时确定命名空间） ----------
export function getCurrentUserSync(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

/** 用户命名空间键：登录后各存储互相隔离（切换用户会刷新页面） */
export function userScopedKey(base: string): string {
  const u = getCurrentUserSync()
  return u ? `u:${u}:${base}` : base
}

function readRegistry(): UserProfile[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    const list = raw ? (JSON.parse(raw) as UserProfile[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeRegistry(list: UserProfile[]): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function listUserNames(): string[] {
  return readRegistry().map((u) => u.name)
}

interface UserStore {
  /** 当前登录用户昵称（null = 未登录） */
  current: string | null
  /** 本机已注册的昵称列表 */
  users: string[]
  register: (name: string, pass: string) => Promise<void>
  login: (name: string, pass: string) => Promise<void>
  logout: () => void
}

// 注册/登录成功后写入会话并刷新页面：
// 各 store（题库/设置/缓存）在页面加载时按当前用户命名空间初始化
export const useUserStore = create<UserStore>()((set) => ({
  current: getCurrentUserSync(),
  users: listUserNames(),

  register: async (name, pass) => {
    const n = name.trim()
    if (!n) throw new Error('请输入昵称')
    if (n.length > 20) throw new Error('昵称最长 20 个字')
    if (pass && pass.length < 4) throw new Error('密码至少 4 位（留空则不设密码）')
    const list = readRegistry()
    if (list.some((u) => u.name === n)) throw new Error('这个昵称已注册过，请直接登录')
    const passHash = pass ? await hashPassword(n, pass) : ''
    list.push({ name: n, passHash, createdAt: Date.now() })
    writeRegistry(list)
    try {
      localStorage.setItem(SESSION_KEY, n)
    } catch {
      /* ignore */
    }
    set({ current: n, users: list.map((u) => u.name) })
    if (typeof location !== 'undefined') location.reload()
  },

  login: async (name, pass) => {
    const n = name.trim()
    if (!n) throw new Error('请输入昵称')
    const hit = readRegistry().find((u) => u.name === n)
    if (!hit) throw new Error('没有这个昵称，请先注册')
    if (hit.passHash) {
      const h = await hashPassword(n, pass)
      if (h !== hit.passHash) throw new Error('密码不对，再试试')
    }
    try {
      localStorage.setItem(SESSION_KEY, n)
    } catch {
      /* ignore */
    }
    set({ current: n })
    if (typeof location !== 'undefined') location.reload()
  },

  logout: () => {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
    set({ current: null })
    if (typeof location !== 'undefined') location.reload()
  },
}))
