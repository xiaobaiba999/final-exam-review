// 前端数据访问层（纯本地版）
// 原版通过 /api/* 调用服务端 + 数据库；现在全部在浏览器完成：
// - runAiStream   -> 调用本地识别管线 parse-ai（浏览器直连硅基流动）
// - importQuestions/deleteQuestion/clearQuestions -> question-store 本地持久化
// - runExplain    -> 本地解析生成管线 explain
// 组件调用接口与旧版保持一致，UI 层零迁移成本。
'use client'

import { AiStreamEvent, ParsedQuestion } from './types'
import { runParsePipeline } from './parse-ai'
import {
  useQuestionStore,
  StoredQuestion,
  PatchResult,
  QuestionAction,
} from './question-store'

export type { StoredQuestion, PatchResult, QuestionAction }
export type { AiStreamEvent, ParsedQuestion }

// ---------- AI 识别 ----------
export interface RunAiStreamHandlers {
  onEvent: (ev: AiStreamEvent) => void
}

export interface RunAiStreamOptions {
  signal?: AbortSignal
}

/**
 * 与旧版签名一致：上传文件并消费识别事件流。
 * 内部实现：本地解析 + 浏览器直连 AI，事件实时回调。
 * 管线内部已包含限流守卫/缓存/补跑；此处错误不再需要断线重连语义，
 * 保留 shouldReconnect 供 UI 兼容（恒 false）。
 */
export async function runAiStream(
  input: { file: File; force?: boolean },
  handlers: RunAiStreamHandlers,
  _attempt = 0,
  options: RunAiStreamOptions = {}
): Promise<void> {
  await runParsePipeline({
    file: input.file,
    force: input.force,
    signal: options.signal,
    onEvent: handlers.onEvent,
  })
}

export function isTransient(_e: unknown): boolean {
  return false
}

export function shouldReconnect(_e: unknown, _attempt: number): boolean {
  return false
}

// ---------- 题库操作（本地） ----------
export async function fetchQuestions(): Promise<StoredQuestion[]> {
  const st = useQuestionStore.getState()
  await st.load()
  return useQuestionStore.getState().questions
}

export async function importQuestions(
  questions: ParsedQuestion[],
  source: string
): Promise<{ imported: number }> {
  const imported = useQuestionStore.getState().importAll(questions, source)
  if (imported === 0 && questions.length > 0) throw new Error('没有可导入的题目')
  return { imported }
}

export async function deleteQuestion(id: string): Promise<void> {
  useQuestionStore.getState().remove(id)
}

export async function clearQuestions(): Promise<void> {
  useQuestionStore.getState().clear()
}

// 题目状态变更：收藏 / 答错入本 / 答对出本（本地直接计算）
export async function patchQuestion(id: string, action: QuestionAction): Promise<PatchResult> {
  return useQuestionStore.getState().applyAction(id, action)
}

// ---------- AI 解析补全（本地） ----------
export async function runExplain(limit = 8): Promise<{ updated: number; remaining: number }> {
  const { runExplainBatch } = await import('./explain')
  return runExplainBatch(limit)
}
