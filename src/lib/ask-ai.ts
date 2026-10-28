// 题目追问 AI（多轮）：以题目+解析为上下文，学生继续提问，AI 详细解答
// - 流式输出（chatSafeStream），限流守卫与全局共享
// - 对话历史随题目存 IndexedDB（question-store.appendChat），导出/迁移自动携带
'use client'

import { chatSafeStream, createRateGuard, ChatMessage } from './ai'
import { useSettingsStore, resolveAi, publicAiAvailable } from './settings-store'
import { StoredQuestion } from './question-store'
import { ChatMsg, QuestionType, TYPE_LABELS } from './types'

// 追问与单题解析共享一条守卫：429 惩罚窗口全局生效
const tutorGuard = createRateGuard()

const TUTOR_SYSTEM = `你是经验丰富的大学课程助教，正在帮学生逐一攻克复习题。回答学生针对本题的追问时：
1. 紧扣题目本身作答：先给结论，再给理由；必要时分点讲解。
2. 涉及计算或推理时写出关键步骤；学生问「为什么选/不选某项」时，要对比辨析相关选项。
3. 学生问扩展知识时可以适度延伸，但始终回到本题考点收尾。
4. 不确定的内容如实说明，不要编造。
5. 用中文回答，长度与问题匹配：简单问题 2-4 句，复杂问题可分点展开。`

// 组装对话消息：系统提示（含题目上下文）+ 最近若干轮历史 + 本次提问
export function buildTutorMessages(
  q: StoredQuestion,
  history: ChatMsg[],
  userText: string
): ChatMessage[] {
  const typeLabel = TYPE_LABELS[q.type as QuestionType] ?? q.type
  const parts = [`【当前题目】`, `题型：${typeLabel}`, `题干：${q.stem}`]
  if (q.options.length > 0) {
    parts.push(`选项：\n${q.options.map((o) => `${o.key}. ${o.text}`).join('\n')}`)
  }
  parts.push(q.answer.trim() ? `参考答案：${q.answer}` : '（本题无标准答案）')
  if (q.explanation.trim()) {
    parts.push(`已有解析：${q.explanation}`)
  }
  const system = `${TUTOR_SYSTEM}\n\n${parts.join('\n')}`

  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  // 只带最近 12 条历史，防止上下文过长
  for (const m of history.slice(-12)) {
    messages.push({ role: m.role, content: m.content })
  }
  messages.push({ role: 'user', content: userText })
  return messages
}

/** 发送一条追问，流式返回完整回复文本 */
export async function askFollowUp(
  q: StoredQuestion,
  history: ChatMsg[],
  userText: string,
  onDelta: (full: string) => void
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
  return chatSafeStream(
    buildTutorMessages(q, history, userText),
    { guard: tutorGuard, apiKey: ai.key, model: ai.model, baseUrl: ai.baseUrl, temperature: 0.4 },
    onDelta
  )
}
