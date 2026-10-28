// 跨 Tab 的轻量 UI 状态（不持久化，仅会话内共享）：
// - bankScope：题库列表的范围筛选（全部/错题本/收藏）。
//   提升到 store 是为了让「复习页统计卡」点击后能跨 Tab 跳转并预置筛选。
'use client'

import { create } from 'zustand'

export type BankScope = 'all' | 'wrong' | 'starred'

interface UiStore {
  bankScope: BankScope
  setBankScope: (s: BankScope) => void
}

export const useUiStore = create<UiStore>((set) => ({
  bankScope: 'all',
  setBankScope: (s) => set({ bankScope: s }),
}))
