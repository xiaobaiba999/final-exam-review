// 应用设置 store：API Key / 模型 / GitHub 云同步配置
// 存储位置：浏览器 localStorage（持久、仅本机）
// 安全边界：Key 与 PAT 只保存在使用者自己的浏览器中，
// AI 调用由浏览器直连硅基流动，云同步数据文件不含 Key 与 PAT。
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash'
export const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'

export interface AppSettings {
  /** 硅基流动 API Key（sk- 开头） */
  apiKey: string
  /** 模型名 */
  model: string
  /** OpenAI 兼容接口 Base URL */
  baseUrl: string
  /** GitHub Personal Access Token（可选，用于云同步） */
  ghPat: string
  /** GitHub 仓库，格式 owner/repo（可选） */
  ghRepo: string
  /** 变更后自动上传到 GitHub */
  autoSync: boolean
  /** 上次云同步时间（epoch ms，0 = 从未） */
  lastSyncAt: number
  /** 上次云同步状态信息（成功/失败原因） */
  lastSyncMsg: string
}

interface SettingsStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void
  /** AI 是否已配置可用 */
  hasKey: () => boolean
  /** 云同步是否已配置可用 */
  hasSync: () => boolean
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      apiKey: '',
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL,
      ghPat: '',
      ghRepo: '',
      autoSync: true,
      lastSyncAt: 0,
      lastSyncMsg: '',

      update: (patch) => set(patch),

      hasKey: () => {
        const { apiKey, model, baseUrl } = get()
        return apiKey.trim().length > 10 && model.trim().length > 0 && baseUrl.trim().length > 0
      },

      hasSync: () => {
        const { ghPat, ghRepo } = get()
        return (
          ghPat.trim().length > 10 &&
          /^[\w.-]+\/[\w.-]+$/.test(ghRepo.trim())
        )
      },
    }),
    {
      name: 'exam-review-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl,
        ghPat: s.ghPat,
        ghRepo: s.ghRepo,
        autoSync: s.autoSync,
        lastSyncAt: s.lastSyncAt,
        lastSyncMsg: s.lastSyncMsg,
      }),
    }
  )
)
