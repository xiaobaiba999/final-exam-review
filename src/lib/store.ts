import { create } from 'zustand'
import type {
  QuestionRecord,
  QuestionType,
  ReviewMode,
} from './types'

export type AppView =
  | 'banks' // 题库首页
  | 'import' // 导入向导
  | 'browse' // 题目浏览
  | 'setup' // 复习设置
  | 'review' // 复习中
  | 'stats' // 统计

export interface ReviewSession {
  bankId: string
  bankName: string
  mode: ReviewMode
  typeFilter: QuestionType | null
  questions: QuestionRecord[]
}

interface AppState {
  view: AppView
  activeBankId: string | null
  activeBankName: string
  /** 题库列表数据版本号，变更后 +1 触发刷新 */
  banksVersion: number
  /** 复习会话 */
  session: ReviewSession | null
  /** 全局刷新 key（题目变更后 +1） */
  dataVersion: number

  setView: (view: AppView) => void
  openBank: (id: string, name: string) => void
  refreshBanks: () => void
  bumpDataVersion: () => void
  startReview: (session: ReviewSession) => void
  endReview: () => void
  /** 更新会话内某题的本地状态（乐观更新） */
  updateSessionQuestion: (
    id: string,
    patch: Partial<QuestionRecord>,
  ) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'banks',
  activeBankId: null,
  activeBankName: '',
  banksVersion: 0,
  session: null,
  dataVersion: 0,

  setView: (view) => set({ view }),
  openBank: (id, name) =>
    set({ activeBankId: id, activeBankName: name, view: 'browse' }),
  refreshBanks: () =>
    set((s) => ({ banksVersion: s.banksVersion + 1 })),
  bumpDataVersion: () =>
    set((s) => ({ dataVersion: s.dataVersion + 1 })),
  startReview: (session) =>
    set({ session, view: 'review' }),
  endReview: () =>
    set((s) => ({
      session: null,
      view: 'setup',
      banksVersion: s.banksVersion + 1,
      dataVersion: s.dataVersion + 1,
    })),
  updateSessionQuestion: (id, patch) =>
    set((s) => {
      if (!s.session) return s
      return {
        session: {
          ...s.session,
          questions: s.session.questions.map((q) =>
            q.id === id ? { ...q, ...patch } : q,
          ),
        },
      }
    }),
}))
