// 共享题库 store：跨 Tab 单例缓存，切换页面不重复请求（感知秒开）
// - 首次进入预取一次，之后题库/复习页直接读缓存
// - 星标/错题等操作先乐观更新本地，再异步落库并对账
'use client'

import { create } from 'zustand'
import {
  StoredQuestion,
  fetchQuestions,
  patchQuestion,
  PatchResult,
  QuestionAction,
} from './api-client'

interface QuestionStore {
  questions: StoredQuestion[]
  loading: boolean
  loadedOnce: boolean
  error: string | null
  loadPromise: Promise<void> | null
  /** 拉取题库；force=true 跳过缓存强制刷新 */
  load: (force?: boolean) => Promise<void>
  /** 本地乐观更新单题 */
  patchLocal: (id: string, patch: Partial<StoredQuestion>) => void
  /** 本地移除单题（删除后） */
  removeLocal: (id: string) => void
  /** 清空本地（清空题库后） */
  resetLocal: () => void
  /** 收藏/错题联动：乐观更新 + 服务端落库，返回最终状态 */
  applyAction: (id: string, action: QuestionAction) => Promise<PatchResult>
}

export const useQuestionStore = create<QuestionStore>((set, get) => ({
  questions: [],
  loading: false,
  loadedOnce: false,
  error: null,
  loadPromise: null,

  load: async (force = false) => {
    // 进行中的请求直接复用（去重）
    if (get().loadPromise) return get().loadPromise!
    if (get().loadedOnce && !force && !get().error) return
    const p = (async () => {
      set({ loading: true, error: null })
      try {
        const qs = await fetchQuestions()
        set({ questions: qs, loadedOnce: true, loading: false, loadPromise: null })
      } catch (e) {
        set({
          loading: false,
          loadPromise: null,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    set({ loadPromise: p })
    return p
  },

  patchLocal: (id, patch) =>
    set((s) => ({
      questions: s.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    })),

  removeLocal: (id) =>
    set((s) => ({ questions: s.questions.filter((q) => q.id !== id) })),

  resetLocal: () => set({ questions: [], loadedOnce: false, error: null }),

  applyAction: async (id, action) => {
    // 乐观更新：先让 UI 立即响应
    const prev = get().questions.find((q) => q.id === id)
    if (prev) {
      const optimistic: Partial<StoredQuestion> =
        action === 'star'
          ? { starred: true }
          : action === 'unstar'
            ? { starred: false }
            : action === 'markWrong'
              ? { wrong: true, wrongCount: prev.wrongCount + 1 }
              : action === 'markRight'
                ? { wrong: false, rightCount: prev.rightCount + 1 }
                : { wrong: false }
      get().patchLocal(id, optimistic)
    }
    try {
      const result = await patchQuestion(id, action)
      get().patchLocal(id, result)
      return result
    } catch (e) {
      // 失败回滚
      if (prev) get().patchLocal(id, prev)
      throw e
    }
  },
}))
