// 共享题库 store（纯本地版）：数据存浏览器 IndexedDB（idb-keyval）
// - 无数据库、无后端：题库/进度/错题本/收藏全部本机持久化，秒读秒写
// - 三 Tab 共用一份数据，切换零等待
// - 星标/错题等操作直接本地计算（原服务端维护的逻辑已内置）
// - 变更后按设置触发 GitHub 云同步（防抖，见 github-sync）
'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { normalizeStem, ParsedQuestion } from './types'
import { scheduleAutoSync, registerQuestionsGetter } from './github-sync'

// 与原服务端版本一致的数据结构
export interface StoredQuestion {
  id: string
  type: string
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string
  explanation: string
  source: string
  createdAt: string
  /** 已收藏 */
  starred: boolean
  /** 在错题本中（答错自动进入，答对自动移出） */
  wrong: boolean
  /** 累计答对次数 */
  rightCount: number
  /** 累计答错次数 */
  wrongCount: number
}

export type QuestionAction = 'star' | 'unstar' | 'markWrong' | 'markRight' | 'removeWrong'

export interface PatchResult {
  starred: boolean
  wrong: boolean
  rightCount: number
  wrongCount: number
}

// IndexedDB 存储适配（zustand persist 异步 storage 接口）
const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return (await idbGet<string>(name)) ?? null
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await idbSet(name, value)
    } catch {
      /* 配额异常不阻塞 UI */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await idbDel(name)
    } catch {
      /* ignore */
    }
  },
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

interface QuestionStore {
  questions: StoredQuestion[]
  loading: boolean
  loadedOnce: boolean
  hydrated: boolean
  error: string | null
  loadPromise: Promise<void> | null
  /** 兼容旧接口：本地模式下等待 IndexedDB 恢复完成 */
  load: (force?: boolean) => Promise<void>
  /** 本地乐观更新单题 */
  patchLocal: (id: string, patch: Partial<StoredQuestion>) => void
  /** 本地移除单题（删除后） */
  removeLocal: (id: string) => void
  /** 清空本地（清空题库后） */
  resetLocal: () => void
  /** 收藏/错题联动：本地直接计算并持久化 */
  applyAction: (id: string, action: QuestionAction) => Promise<PatchResult>
  /** 导入识别结果（全量追加，与原服务端语义一致） */
  importAll: (questions: ParsedQuestion[], source: string) => number
  /** 删除单题 */
  remove: (id: string) => void
  /** 清空题库 */
  clear: () => void
  /** 批量更新解析（AI 解析补全后写回） */
  updateExplanations: (items: Array<{ id: string; answer: string; explanation: string }>) => number
  /** 云端/文件恢复：直接写入完整题目数据（保留 id 与学习进度） */
  restoreAll: (questions: StoredQuestion[], mode: 'replace' | 'merge') => number
}

export const useQuestionStore = create<QuestionStore>()(
  persist(
    (set, get) => ({
      questions: [],
      loading: false,
      loadedOnce: false,
      hydrated: false,
      error: null,
      loadPromise: null,

      load: async (_force = false) => {
        // 本地模式：等待 hydration 完成（幂等）
        if (get().hydrated) return
        if (get().loadPromise) return get().loadPromise!
        const p = new Promise<void>((resolve) => {
          const start = Date.now()
          const tick = () => {
            if (get().hydrated || Date.now() - start > 5000) {
              set({ hydrated: true, loadedOnce: true, loading: false })
              resolve()
            } else {
              setTimeout(tick, 60)
            }
          }
          set({ loading: true })
          tick()
        })
        set({ loadPromise: p })
        return p
      },

      patchLocal: (id, patch) =>
        set((s) => ({
          questions: s.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
        })),

      removeLocal: (id) => set((s) => ({ questions: s.questions.filter((q) => q.id !== id) })),

      resetLocal: () => set({ questions: [], loadedOnce: false, error: null }),

      applyAction: async (id, action) => {
        const prev = get().questions.find((q) => q.id === id)
        if (!prev) throw new Error('题目不存在')
        // 与原服务端 PATCH 语义完全一致
        const patch: Partial<StoredQuestion> =
          action === 'star'
            ? { starred: true }
            : action === 'unstar'
              ? { starred: false }
              : action === 'markWrong'
                ? { wrong: true, wrongCount: prev.wrongCount + 1 }
                : action === 'markRight'
                  ? { wrong: false, rightCount: prev.rightCount + 1 }
                  : { wrong: false } // removeWrong
        get().patchLocal(id, patch)
        const next = get().questions.find((q) => q.id === id)
        scheduleAutoSync()
        return {
          starred: next!.starred,
          wrong: next!.wrong,
          rightCount: next!.rightCount,
          wrongCount: next!.wrongCount,
        }
      },

      importAll: (questions, source) => {
        const src = String(source ?? '').slice(0, 200)
        const now = new Date().toISOString()
        const rows: StoredQuestion[] = questions
          .filter((q) => q && q.stem && q.stem.trim())
          .map((q) => ({
            id: newId(),
            type: q.type,
            stem: q.stem.trim(),
            options: Array.isArray(q.options) ? q.options : [],
            answer: String(q.answer ?? ''),
            explanation: String(q.explanation ?? ''),
            source: src,
            createdAt: now,
            starred: false,
            wrong: false,
            rightCount: 0,
            wrongCount: 0,
          }))
        if (rows.length > 0) {
          set((s) => ({ questions: [...s.questions, ...rows], loadedOnce: true }))
          scheduleAutoSync()
        }
        return rows.length
      },

      remove: (id) => {
        get().removeLocal(id)
        scheduleAutoSync()
      },

      clear: () => {
        get().resetLocal()
        scheduleAutoSync()
      },

      updateExplanations: (items) => {
        let updated = 0
        set((s) => ({
          questions: s.questions.map((q) => {
            const hit = items.find((it) => it.id === q.id)
            if (!hit) return q
            const explanation = String(hit.explanation ?? '').trim()
            const answer = String(hit.answer ?? '').trim()
            if (!explanation && !answer) return q
            updated++
            return {
              ...q,
              explanation: explanation || q.explanation,
              // 仅当原答案为空时才采纳 AI 答案，绝不覆盖原有答案
              answer: q.answer.trim() ? q.answer : answer,
            }
          }),
        }))
        if (updated > 0) scheduleAutoSync()
        return updated
      },

      restoreAll: (incoming, mode) => {
        const rows = incoming
          .filter((q) => q && q.stem && q.stem.trim())
          .map((q) => ({
            ...q,
            id: q.id || newId(),
            options: Array.isArray(q.options) ? q.options : [],
            answer: String(q.answer ?? ''),
            explanation: String(q.explanation ?? ''),
            starred: Boolean(q.starred),
            wrong: Boolean(q.wrong),
            rightCount: Number(q.rightCount) || 0,
            wrongCount: Number(q.wrongCount) || 0,
          }))
        if (mode === 'replace') {
          set({ questions: rows, loadedOnce: true })
          scheduleAutoSync()
          return rows.length
        }
        // merge：按题干去重，只补本机没有的题（保留本机已有题的进度）
        const existing = new Set(get().questions.map((q) => normalizeStem(q.stem)))
        const toAdd = rows.filter((q) => !existing.has(normalizeStem(q.stem)))
        if (toAdd.length > 0) {
          set((s) => ({ questions: [...s.questions, ...toAdd], loadedOnce: true }))
          scheduleAutoSync()
        }
        return toAdd.length
      },
    }),
    {
      name: 'exam-review-questions',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ questions: s.questions }) as unknown as QuestionStore,
      onRehydrateStorage: () => () => {
        // IndexedDB 恢复完成（或失败）后标记，避免 load() 无限等待
        useQuestionStore.setState({ hydrated: true, loadedOnce: true, loading: false })
      },
    }
  )
)

// 去重辅助（导入预览/清理场景备用）
export function dedupeByStem(qs: StoredQuestion[]): StoredQuestion[] {
  const seen = new Set<string>()
  return qs.filter((q) => {
    const k = normalizeStem(q.stem)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// 注册云同步数据源（避免循环依赖）
registerQuestionsGetter(() => useQuestionStore.getState().questions)
