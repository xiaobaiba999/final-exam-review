// 全局共享类型定义

export type QuestionType = 'single' | 'judge' | 'blank' | 'short'

export const QUESTION_TYPES: QuestionType[] = ['single', 'judge', 'blank', 'short']

export const TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题',
}

export interface QuestionOption {
  key: string // A / B / C / D ...
  text: string
}

// 追问对话消息（每题独立保存，随题目持久化与导出迁移）
export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

// LLM 抽取出的原始题目（流式预览 / 入库前统一使用）
export interface ParsedQuestion {
  type: QuestionType
  stem: string
  options: QuestionOption[]
  answer: string
  explanation: string
  // 入库后由数据库填充
  id?: string
}

// 流式识别的 SSE 事件
export type AiStreamEvent =
  | { type: 'stage'; stage: string; message: string }
  | { type: 'progress'; current: number; total: number; message: string; found: number }
  | { type: 'questions'; questions: ParsedQuestion[]; batch: number }
  | { type: 'questions-replace'; questions: ParsedQuestion[] }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string; fatal?: boolean }
  | {
      type: 'done'
      total: number
      answered: number
      failedChunks: number
      supplement: number
      filtered: number
      fileName: string
    }

export function isQuestionType(v: string): v is QuestionType {
  return (QUESTION_TYPES as string[]).includes(v)
}

// 归一化题干用于去重：去掉空白与常见标点差异
export function normalizeStem(stem: string): string {
  return stem
    .replace(/\s+/g, '')
    .replace(/[，,。．、;；:："'‘’“”()（）\[\]【】?!？!]/g, '')
    .toLowerCase()
}
