// GitHub 云同步（模拟 Zepp-Steps-Automation 的 state.json 模式）
// 把题库/进度/错题本打包为 JSON 文件，通过 GitHub Contents API
// 提交到使用者自己的仓库（如 data/review-data.json），换设备可恢复。
// 安全边界：同步文件只含学习数据，绝不含 API Key 与 GitHub PAT。
'use client'

import { StoredQuestion } from './question-store'
import { useSettingsStore } from './settings-store'

const DATA_PATH = 'data/review-data.json'

export interface ReviewData {
  version: 1
  app: 'exam-review'
  exportedAt: string
  questions: StoredQuestion[]
}

export function buildReviewData(questions: StoredQuestion[]): ReviewData {
  return {
    version: 1,
    app: 'exam-review',
    exportedAt: new Date().toISOString(),
    questions,
  }
}

// ---------- 一键准备私有数据仓库 ----------
// 仿 Zepp-Steps-Automation 的「只要配好凭据，其余自动」体验：
// 检测 PAT → 获取用户名 → 数据仓库不存在则自动创建（私有）→ 返回 owner/repo
export async function ensureDataRepo(pat: string): Promise<string> {
  const token = pat.trim()
  if (token.length < 10) throw new Error('请先填写 GitHub Token（PAT）')

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // 1. 获取用户名
  const uRes = await fetch('https://api.github.com/user', { headers, cache: 'no-store' })
  if (uRes.status === 401) throw new Error('GitHub Token 无效或已过期（401），请检查设置')
  if (!uRes.ok) throw new Error(`GitHub 用户信息获取失败（${uRes.status}）`)
  const login = ((await uRes.json()) as { login?: string }).login
  if (!login) throw new Error('无法识别 GitHub 用户名')
  const repo = `${login}/final-exam-review-data`

  // 2. 仓库已存在则直接返回
  const rRes = await fetch(`https://api.github.com/repos/${repo}`, { headers, cache: 'no-store' })
  if (rRes.ok) return repo
  if (rRes.status !== 404) throw new Error(`GitHub 仓库检测失败（${rRes.status}）`)

  // 3. 不存在 → 自动创建（私有）
  const cRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'final-exam-review-data',
      private: true,
      description: '期末复习工具云同步数据仓库（题库/进度/错题本）',
      auto_init: true,
      has_wiki: false,
      has_projects: false,
      has_issues: false,
    }),
  })
  if (!cRes.ok) {
    const j = (await cRes.json().catch(() => ({}))) as { message?: string }
    throw new Error(
      `自动创建仓库失败（${cRes.status}）：${j.message ?? cRes.statusText}。` +
        `可到 github.com/new 手动创建私有仓库后，在下方填写「用户名/final-exam-review-data」`
    )
  }
  return repo
}

// ---------- 内部：Contents API ----------
function apiBase(repo: string): string {
  return `https://api.github.com/repos/${repo}/contents/${DATA_PATH}`
}

function authHeaders(pat: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

interface ContentsResp {
  sha?: string
  content?: string
  message?: string
}

async function getRemoteSha(pat: string, repo: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(apiBase(repo), {
    headers: authHeaders(pat),
    signal,
    // 绕过浏览器缓存，确保拿到最新 sha
    cache: 'no-store',
  })
  if (res.status === 404) return null // 文件不存在 = 首次上传
  if (res.status === 401) throw new Error('GitHub PAT 无效或已过期（401），请检查设置')
  if (res.status === 403) throw new Error('GitHub 拒绝访问（403）：PAT 权限不足或触发限流')
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as ContentsResp
    throw new Error(`GitHub 读取失败（${res.status}）：${j.message ?? res.statusText}`)
  }
  const j = (await res.json()) as ContentsResp
  return j.sha ?? null
}

// ---------- 上传 ----------
export async function syncToGitHub(questions: StoredQuestion[], signal?: AbortSignal): Promise<{ sha: string }> {
  const s = useSettingsStore.getState()
  if (!s.hasSync()) throw new Error('未配置云同步：请在设置中填入 GitHub PAT 与仓库名')
  const pat = s.ghPat.trim()
  const repo = s.ghRepo.trim()

  const sha = await getRemoteSha(pat, repo, signal)
  const data = buildReviewData(questions)
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))))
  const res = await fetch(apiBase(repo), {
    method: 'PUT',
    headers: { ...authHeaders(pat), 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      message: `chore: 同步复习数据（${questions.length} 题，${new Date().toLocaleString('zh-CN')}）`,
      content,
      ...(sha ? { sha } : {}),
    }),
  })
  if (res.status === 401) throw new Error('GitHub PAT 无效或已过期（401），请检查设置')
  if (res.status === 403) throw new Error('GitHub 拒绝访问（403）：PAT 需要 repo（classic）或 Contents 读写（fine-grained）权限')
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as ContentsResp
    throw new Error(`GitHub 上传失败（${res.status}）：${j.message ?? res.statusText}`)
  }
  const j = (await res.json()) as ContentsResp
  const newSha = j.sha ?? sha ?? ''
  useSettingsStore.getState().update({
    lastSyncAt: Date.now(),
    lastSyncMsg: `已上传 ${questions.length} 题到 ${repo}`,
  })
  return { sha: newSha }
}

// ---------- 恢复 ----------
export async function pullFromGitHub(signal?: AbortSignal): Promise<ReviewData> {
  const s = useSettingsStore.getState()
  if (!s.hasSync()) throw new Error('未配置云同步：请在设置中填入 GitHub PAT 与仓库名')
  const pat = s.ghPat.trim()
  const repo = s.ghRepo.trim()

  const res = await fetch(apiBase(repo), {
    headers: authHeaders(pat),
    signal,
    cache: 'no-store',
  })
  if (res.status === 404) throw new Error('云端还没有数据文件（data/review-data.json 不存在），先在原设备上传一次')
  if (res.status === 401) throw new Error('GitHub PAT 无效或已过期（401），请检查设置')
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as ContentsResp
    throw new Error(`GitHub 读取失败（${res.status}）：${j.message ?? res.statusText}`)
  }
  const j = (await res.json()) as ContentsResp
  if (!j.content) throw new Error('云端文件内容为空')
  // GitHub 返回 base64（带换行），容错解码
  const raw = j.content.replace(/\s+/g, '')
  const json = decodeURIComponent(escape(atob(raw)))
  const data = JSON.parse(json) as ReviewData
  if (data?.app !== 'exam-review' || !Array.isArray(data.questions)) {
    throw new Error('云端文件格式不正确，不是本应用的数据文件')
  }
  return data
}

// 恢复到本地（覆盖或合并）
export async function restoreFromGitHub(
  mode: 'replace' | 'merge',
  apply: (questions: StoredQuestion[], mode: 'replace' | 'merge') => void
): Promise<number> {
  const data = await pullFromGitHub()
  apply(data.questions, mode)
  useSettingsStore.getState().update({
    lastSyncAt: Date.now(),
    lastSyncMsg: `已从 ${useSettingsStore.getState().ghRepo} 恢复 ${data.questions.length} 题`,
  })
  return data.questions.length
}

// ---------- 防抖自动同步 ----------
let autoTimer: ReturnType<typeof setTimeout> | null = null
const AUTO_SYNC_DELAY_MS = 45_000

// 由 question-store 注册（避免循环依赖）：返回当前全部题目
let questionsGetter: () => StoredQuestion[] = () => []
export function registerQuestionsGetter(fn: () => StoredQuestion[]): void {
  questionsGetter = fn
}

/** 学习动作/导入后调用：开启自动同步时，防抖 45s 后上传一次 */
export function scheduleAutoSync(): void {
  const s = useSettingsStore.getState()
  if (!s.autoSync || !s.hasSync()) return
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    void syncToGitHub(questionsGetter()).catch((e) => {
      useSettingsStore.getState().update({
        lastSyncMsg: `自动同步失败：${e instanceof Error ? e.message : String(e)}`,
      })
    })
  }, AUTO_SYNC_DELAY_MS)
}
