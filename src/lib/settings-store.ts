// 应用设置 store（用户命名空间版）：
// - API 来源：公共 API（内置，免配置）/ 我的 API（自己填 Key）
// - 我的 API 预设：硅基流动 / DeepSeek 官方 / 自定义（接口地址自填）
// - Key 只存本机浏览器（按用户命名空间隔离），不进代码、不进仓库
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { userScopedKey } from './user-store'

export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash'
export const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1'
export const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

// ---------- 公共 API（构建时通过环境变量注入，用户无需任何配置即可用） ----------
// NEXT_PUBLIC_PUBLIC_AI_KEY / NEXT_PUBLIC_PUBLIC_AI_BASE_URL / NEXT_PUBLIC_PUBLIC_AI_MODEL
export const PUBLIC_AI = {
  key: String(process.env.NEXT_PUBLIC_PUBLIC_AI_KEY ?? '').trim(),
  baseUrl: String(process.env.NEXT_PUBLIC_PUBLIC_AI_BASE_URL ?? SILICONFLOW_BASE).trim(),
  model: String(process.env.NEXT_PUBLIC_PUBLIC_AI_MODEL ?? DEFAULT_MODEL).trim(),
}
export const publicAiAvailable = PUBLIC_AI.key.length > 10

// ---------- 我的 API 预设 ----------
export type AiProvider = 'siliconflow' | 'deepseek' | 'custom'

export const PROVIDER_PRESETS: Record<
  AiProvider,
  { label: string; baseUrl: string; model: string; keyPlaceholder: string; note: string }
> = {
  siliconflow: {
    label: '硅基流动',
    baseUrl: SILICONFLOW_BASE,
    model: DEFAULT_MODEL,
    keyPlaceholder: 'sk-…（cloud.siliconflow.cn 获取）',
    note: '国内直连快，注册送额度，推荐',
  },
  deepseek: {
    label: 'DeepSeek 官方',
    baseUrl: DEEPSEEK_BASE,
    model: 'deepseek-chat',
    keyPlaceholder: 'sk-…（platform.deepseek.com 获取）',
    note: 'DeepSeek 官方接口，按量付费',
  },
  custom: {
    label: '自定义',
    baseUrl: '',
    model: '',
    keyPlaceholder: 'sk-…',
    note: '任意 OpenAI 兼容接口，地址模型自己填',
  },
}

export type AiSource = 'public' | 'own'

export interface AppSettings {
  /** API 来源：公共 / 自己的 */
  source: AiSource
  /** 我的 API 使用的预设 */
  provider: AiProvider
  apiKey: string
  model: string
  baseUrl: string
}

export interface ResolvedAi {
  ok: boolean
  key: string
  baseUrl: string
  model: string
  label: string
}

function resolveOwn(s: AppSettings): ResolvedAi {
  // 预设缺省兜底：没填地址/模型时按当前预设默认值补齐
  const preset = PROVIDER_PRESETS[s.provider] ?? PROVIDER_PRESETS.siliconflow
  const baseUrl = (s.baseUrl.trim() || preset.baseUrl || SILICONFLOW_BASE).trim()
  const model = (s.model.trim() || preset.model || DEFAULT_MODEL).trim()
  const key = s.apiKey.trim()
  return { ok: key.length > 10 && model.length > 0 && baseUrl.length > 0, key, baseUrl, model, label: '我的 API' }
}

/** 统一出口：所有 AI 调用都从这里拿凭据 */
export function resolveAi(s: AppSettings): ResolvedAi {
  if (s.source === 'public') {
    if (publicAiAvailable) {
      return { ok: true, key: PUBLIC_AI.key, baseUrl: PUBLIC_AI.baseUrl, model: PUBLIC_AI.model, label: '公共 API' }
    }
    return {
      ok: false,
      key: '',
      baseUrl: PUBLIC_AI.baseUrl,
      model: PUBLIC_AI.model,
      label: '公共 API（未配置）',
    }
  }
  return resolveOwn(s)
}

interface SettingsStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void
  /** 切换预设：自动填入该接口的默认地址与模型 */
  usePreset: (p: AiProvider) => void
  aiReady: () => boolean
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      source: 'public',
      provider: 'siliconflow',
      apiKey: '',
      model: '',
      baseUrl: '',

      update: (patch) => set(patch),

      usePreset: (p) => {
        if (p === 'custom') {
          set({ provider: p })
          return
        }
        const preset = PROVIDER_PRESETS[p]
        set({ provider: p, baseUrl: preset.baseUrl, model: preset.model })
      },

      aiReady: () => resolveAi(get()).ok,
    }),
    {
      name: userScopedKey('exam-review-settings'),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        source: s.source,
        provider: s.provider,
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl,
      }),
      // 旧版本迁移：老数据里存过 apiKey（且没有 source 字段）→ 视为「我的 API」
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppSettings> & { ghPat?: string }
        const merged: SettingsStore = { ...current, ...p }
        if (!p.source) merged.source = p.apiKey && p.apiKey.trim().length > 10 ? 'own' : 'public'
        return merged
      },
    }
  )
)
