// AI 解析补全（本地版）：为缺少解析的题目批量生成解析；支持单题流式生成详细解析
// 原版为 /api/explain 服务端路由，逻辑 1:1 迁移到浏览器执行
'use client'

import { chatSafe, chatSafeStream, createRateGuard, extractJson } from '@/lib/ai'
import { useQuestionStore, StoredQuestion } from '@/lib/question-store'
import { useSettingsStore, resolveAi, publicAiAvailable } from '@/lib/settings-store'
import { TYPE_LABELS, QuestionType } from '@/lib/types'

const BATCH = 4

const SYSTEM = `你是考试解析生成器。为每道题生成详细准确的中文解析，规则：
1. 先指出正确答案及其核心依据；单选题需辨析关键干扰项为何不对；判断题说明判断依据与易错点；填空/简答题给出答案要点与关键词。
2. 解析控制在 2-5 句话、不超过 200 字，语言简明准确。
3. 题目本身没有标准答案时，依据专业知识给出最可信的答案并解析。
4. 只输出 JSON：{"items":[{"id":"题目id","answer":"答案","explanation":"解析"}]}，不要解释文字。`

// 单题详细解析（流式，纯文本输出便于实时展示）
const ONE_SYSTEM = `你是经验丰富的大学课程助教。为给定题目生成一段详细、准确的中文解析，要求：
1. 先给结论：明确指出正确答案及其核心依据。
2. 单选题：简要辨析——为什么正确项对、关键干扰项错。
3. 判断题：给出判断依据与易错点。
4. 填空/简答题：给出完整答案要点、关键词与答题思路。
5. 若题目没有给出标准答案，须依据专业知识给出最可信答案并解析。
6. 直接输出解析正文（纯文本，不要 JSON、不要 Markdown 标记），可分点，总长 80-250 字。`

// 复用一条模块级守卫：单题解析与批量补全共享限流窗口
const oneGuard = createRateGuard()

/** 单题生成详细解析（流式）；成功后写回题库（覆盖旧解析） */
export async function explainOne(
  q: StoredQuestion,
  opts: { onDelta?: (full: string) => void } = {}
): Promise<string> {
  const s = useSettingsStore.getState()
  const ai = resolveAi(s)
  if (!ai.ok) {
    throw new Error(
      s.source === 'public' && !publicAiAvailable
        ? '公共 API 未配置：请点击右上角⚙设置，切换到「我的 API」填入 Key'
        : '我的 API 未配置完整：请点击右上角⚙设置，填入 API Key'
    )
  }
  const typeLabel = TYPE_LABELS[q.type as QuestionType] ?? q.type
  const parts = [`题型：${typeLabel}`, `题干：${q.stem}`]
  if (q.options.length > 0) {
    parts.push(`选项：\n${q.options.map((o) => `${o.key}. ${o.text}`).join('\n')}`)
  }
  if (q.answer.trim()) {
    parts.push(`参考答案：${q.answer}`)
  } else {
    parts.push('（本题没有标准答案，请依据专业知识给出最可信答案并解析）')
  }

  const text = await chatSafeStream(
    [
      { role: 'system', content: ONE_SYSTEM },
      { role: 'user', content: parts.join('\n') },
    ],
    { guard: oneGuard, apiKey: ai.key, model: ai.model, baseUrl: ai.baseUrl, temperature: 0.2 },
    (full) => opts.onDelta?.(full)
  )
  useQuestionStore.getState().patchLocal(q.id, { explanation: text })
  return text
}

export async function runExplainBatch(limit = 8): Promise<{ updated: number; remaining: number }> {
  const s = useSettingsStore.getState()
  const ai = resolveAi(s)
  if (!ai.ok) {
    throw new Error(
      s.source === 'public' && !publicAiAvailable
        ? '公共 API 未配置：请点击右上角⚙设置，切换到「我的 API」填入 Key'
        : '我的 API 未配置完整：请点击右上角⚙设置，填入 API Key'
    )
  }
  const llm = { apiKey: ai.key, model: ai.model, baseUrl: ai.baseUrl }

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
