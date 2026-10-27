// AI 解析补全（本地版）：为缺少解析的题目批量生成解析
// 原版为 /api/explain 服务端路由，逻辑 1:1 迁移到浏览器执行
'use client'

import { chatSafe, createRateGuard, extractJson } from '@/lib/ai'
import { useQuestionStore } from '@/lib/question-store'
import { useSettingsStore } from '@/lib/settings-store'
import { TYPE_LABELS, QuestionType } from '@/lib/types'

const BATCH = 4

const SYSTEM = `你是考试解析生成器。为每道题生成简明准确的解析，规则：
1. 解析需指出正确答案及其依据，1-3 句话，不超过 120 字。
2. 单选题若选项内容已知，需说明为何选它；判断题说明判断依据。
3. 填空/简答题给出答案要点或评分关键词。
4. 题目本身没有标准答案时，依据专业知识给出最可信的答案并解析。
5. 只输出 JSON：{"items":[{"id":"题目id","answer":"答案","explanation":"解析"}]}，不要解释文字。`

export async function runExplainBatch(limit = 8): Promise<{ updated: number; remaining: number }> {
  const s = useSettingsStore.getState()
  if (!s.hasKey()) {
    throw new Error('尚未配置 AI：请点击右上角⚙设置，填入硅基流动 API Key')
  }
  const llm = { apiKey: s.apiKey.trim(), model: s.model.trim(), baseUrl: s.baseUrl.trim() }

  const all = useQuestionStore.getState().questions
  const missing = all.filter((q) => !q.explanation.trim()).slice(0, Math.min(Math.max(limit, 1), 12) * BATCH)
  if (missing.length === 0) {
    return { updated: 0, remaining: 0 }
  }

  const guard = createRateGuard()
  let updated = 0
  for (let i = 0; i < missing.length; i += BATCH) {
    if (updated >= limit) break
    const group = missing.slice(i, i + BATCH)
    const payload = group.map((q) => ({
      id: q.id,
      type: TYPE_LABELS[q.type as QuestionType] ?? q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
    }))
    try {
      const raw = await chatSafe(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify({ items: payload }) },
        ],
        { guard, ...llm }
      )
      const items = extractJsonArr(raw)
      const updates: Array<{ id: string; answer: string; explanation: string }> = []
      for (const item of items) {
        const q = group.find((g) => g.id === item.id)
        if (!q) continue
        const explanation = String(item.explanation ?? '').trim()
        const answer = String(item.answer ?? '').trim()
        if (!explanation && !answer) continue
        updates.push({ id: q.id, answer, explanation })
      }
      if (updates.length > 0) {
        updated += useQuestionStore.getState().updateExplanations(updates)
      }
    } catch (e) {
      // 429 已由守卫处理；其他错误中断本批，保留已更新部分
      if (updated === 0) throw e
      break
    }
  }

  const remaining = useQuestionStore.getState().questions.filter((q) => !q.explanation.trim()).length
  return { updated, remaining }
}

function extractJsonArr(raw: string): Array<{ id?: string; answer?: string; explanation?: string }> {
  const text = raw ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const obj = JSON.parse(m[0])
    return Array.isArray(obj?.items) ? obj.items : []
  } catch {
    return []
  }
}
