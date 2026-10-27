// AI 识别管线（浏览器直连版）
// 原架构：上传到服务端 -> 分块 -> 服务端 LLM 抽取 -> SSE 回传
// 新架构：全部在浏览器完成 -> mammoth/unpdf 解析 -> 分块 ->
//         浏览器直连硅基流动抽取 -> 进度回调实时更新 UI
// 可靠性保留：片段缓存(断点续跑，localStorage 持久) / 整轮缓存(仅零失败完整成功) /
//             同文档并发去重 / 多轮补跑失败片段 / 题号精准补扫 / 文末答案键回填 / 限流守卫
'use client'

import { chatSafe, createRateGuard, extractJson } from '@/lib/ai'
import { extractText } from '@/lib/extract-text'
import {
  chunkByQuestion,
  countItemLines,
  countStemLines,
  dedupeQuestions,
  findMissingNumbers,
  normalizeQuestion,
  applyAnswerKeys,
  hasAnswerKeyRun,
  parseAnswerKeys,
} from '@/lib/qa-parse'
import { contentKey, chunkKey, getChunk, setChunk, getRound, setRound, dropRound } from '@/lib/parse-cache'
import { useSettingsStore, resolveAi, publicAiAvailable } from '@/lib/settings-store'
import { AiStreamEvent, ParsedQuestion } from '@/lib/types'

const LLM_CONCURRENCY = 3
const ROUND_WAITS = [30_000, 60_000, 60_000]

const EXTRACT_SYSTEM = `你是题库数字化引擎。从给定文本片段中逐题抽取全部题目，规则：
1. 逐题完整抽取：一道都不能漏、不能合并、不能改写或缩写题干。
2. 题干必须保留原文完整文字，包括原文自带的题号前缀（如 "12."）；原文没有编号的题目绝对不要自行添加编号。
3. 单选题 type:"single"，options 为 [{"key":"A","text":"选项原文"},...]，answer 为正确选项字母如 "C"。
4. 判断题 type:"judge"，answer 只能是 "正确" 或 "错误"。
5. 填空题 type:"blank"，answer 依原文填空内容；简答题/问答/论述 type:"short"，answer 为参考答案。
6. 题干、选项、答案都必须来自片段原文。若片段本身没有题目（例如只有答案表、代码或说明文字），输出 {"questions":[]}。
7. 片段开头或结尾可能被截断：无法辨认完整题干的残缺题跳过，其余必须输出。
8. 只输出 JSON：{"questions":[...]}，不要任何解释文字。`

export interface RunPipelineOptions {
  file: File
  /** 强制重识：绕过整轮与片段缓存 */
  force?: boolean
  signal?: AbortSignal
  onEvent: (ev: AiStreamEvent) => void
}

// 模块级进行中注册表：同一文档双开识别直接报错（比服务端广播更简单可靠）
const inflight = new Map<string, Promise<void>>()

export class PipelineError extends Error {
  fatal: boolean
  constructor(message: string, fatal = true) {
    super(message)
    this.fatal = fatal
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('已取消', 'AbortError')
  }
}

export async function runParsePipeline(opts: RunPipelineOptions): Promise<void> {
  const { file, force = false, signal, onEvent } = opts
  const fileName = file.name || '未命名文档'

  // 前置检查：AI 必须可用（公共 API 或自己的 Key）
  const s = useSettingsStore.getState()
  const ai = resolveAi(s)
  if (!ai.ok) {
    throw new PipelineError(
      s.source === 'public' && !publicAiAvailable
        ? '公共 API 未配置：请点击右上角⚙设置，切换到「我的 API」填入 Key 后再识别'
        : '我的 API 未配置完整：请点击右上角⚙设置，填入 API Key 后再识别'
    )
  }
  const llm = { apiKey: ai.key, model: ai.model, baseUrl: ai.baseUrl }

  if (file.size > 30 * 1024 * 1024) {
    throw new PipelineError('文件过大（上限 30MB）')
  }

  const buf = await file.arrayBuffer()
  throwIfAborted(signal)
  const runKey = await contentKey(fileName, buf)
  if (force) dropRound(runKey)

  // 同文档并发去重：正在识别时再次触发直接提示
  const running = inflight.get(runKey)
  if (running) {
    throw new PipelineError('该文档正在识别中，请等待完成或稍后再试', false)
  }

  const task = runPipelineInner(fileName, buf, runKey, llm, force, signal, onEvent).finally(() => {
    inflight.delete(runKey)
  })
  inflight.set(runKey, task)
  return task
}

async function runPipelineInner(
  fileName: string,
  buf: ArrayBuffer,
  runKey: string,
  llm: { apiKey: string; model: string; baseUrl: string },
  force: boolean,
  signal: AbortSignal | undefined,
  onEvent: (ev: AiStreamEvent) => void
): Promise<void> {
  const guard = createRateGuard()

  // 1) 整轮缓存命中（仅完整成功的结果会进入缓存）
  const cached = force ? null : getRound(runKey)
  if (cached) {
    onEvent({
      type: 'warning',
      message: `已从本机缓存直接载入上次完整识别结果（共 ${cached.questions.length} 题）；如需重新识别请点「强制重识（不用缓存）」`,
    })
    onEvent({ type: 'questions-replace', questions: cached.questions })
    const answered = cached.questions.filter((q) => q.answer.trim().length > 0).length
    onEvent({
      type: 'done',
      total: cached.questions.length,
      answered,
      failedChunks: 0,
      supplement: 0,
      filtered: 0,
      fileName: cached.fileName,
    })
    return
  }

  try {
    onEvent({ type: 'stage', stage: 'extract', message: '正在解析文档…' })
    const doc = await extractText(fileName, buf)
    throwIfAborted(signal)
    const text = doc.text
    if (text.length < 30) {
      throw new PipelineError(
        '文档内容过少或无法提取文本（扫描版 PDF 暂不支持），请确认文档为可复制的文字版'
      )
    }

    const ranges = chunkByQuestion(text)
    const chunkTotal = ranges.length
    onEvent({
      type: 'stage',
      stage: 'chunks',
      message: `文档共 ${text.length} 字，已按题目边界分为 ${chunkTotal} 片段`,
    })

    const results: Array<{ ok: boolean; questions: ParsedQuestion[] }> = []
    for (let i = 0; i < chunkTotal; i++) results.push({ ok: false, questions: [] })

    const chunkMeta = (idx: number) => {
      const seg = text.slice(ranges[idx].start, ranges[idx].end)
      const stemCount = countStemLines(seg)
      const itemLines = countItemLines(seg)
      const expected = Math.max(stemCount, itemLines)
      const questionish =
        /[？?]/.test(seg) ||
        hasAnswerKeyRun(seg) ||
        /^(简述|试述|叙述|说明|什么是|请|画出|推导|设计|写出|计算|证明|分析|比较)/m.test(seg)
      return { seg, stemCount, itemLines, expected, questionish }
    }

    const runChunk = async (idx: number): Promise<boolean> => {
      throwIfAborted(signal)
      const meta = chunkMeta(idx)
      const seg = meta.seg
      const ck = await chunkKey(runKey, seg, doc.kind)
      // force 时绕过片段缓存：作为真正的逃生门，所有片段全部重新抽取
      const hit = force ? null : getChunk(ck)
      if (hit) {
        results[idx] = { ok: true, questions: hit }
        return true
      }
      const parseQs = (raw: string): ParsedQuestion[] => {
        const parsed = extractJson<{ questions?: unknown[] }>(raw)
        const list = Array.isArray(parsed?.questions) ? parsed!.questions : []
        const qs: ParsedQuestion[] = []
        for (const item of list) {
          const nq = normalizeQuestion(item)
          if (nq) qs.push(nq)
        }
        return qs
      }
      try {
        const raw = await chatSafe(
          [
            { role: 'system', content: EXTRACT_SYSTEM },
            { role: 'user', content: `文本片段（第 ${idx + 1}/${chunkTotal} 段）：\n\n${seg}` },
          ],
          { guard, ...llm }
        )
        let qs = parseQs(raw)

        // ---- 期望题数校验 ----
        const expected = meta.expected
        if (expected >= 6) {
          // 大片段：题目数量应接近期望值，明显偏少则纠错重试，仍不足判失败进补跑
          const isShort = () => qs.length < Math.ceil(expected * 0.5)
          if (isShort()) {
            try {
              const raw2 = await chatSafe(
                [
                  { role: 'system', content: EXTRACT_SYSTEM },
                  {
                    role: 'user',
                    content: `文本片段（第 ${idx + 1}/${chunkTotal} 段）：\n\n${seg}\n\n注意：你之前输出的题目数量远少于片段中实际的题目数。请重新逐题抽取，尤其是带编号的题，一道都不能漏，输出完整 JSON。`,
                  },
                ],
                { guard, ...llm }
              )
              const qs2 = parseQs(raw2)
              if (qs2.length > qs.length) {
                qs = qs2
              }
            } catch {
              /* 保留首次结果 */
            }
            if (isShort()) return false
          }
        } else if (qs.length === 0 && seg.length > 300) {
          // 小片段抽取为空：让模型显式确认是否真的无题（如答案表/代码段），
          // 确认后接受为空，避免误判失败阻断整轮完成
          try {
            const raw2 = await chatSafe(
              [
                { role: 'system', content: EXTRACT_SYSTEM },
                {
                  role: 'user',
                  content: `以下片段疑似包含题目但你没有抽取到任何题。请仔细逐段检查并抽取全部题目，输出完整 JSON；若确实没有任何题目才输出 {"questions":[]}。\n\n${seg}`,
                },
              ],
              { guard, ...llm }
            )
            qs = parseQs(raw2)
          } catch {
            /* ignore */
          }
          if (qs.length === 0) {
            onEvent({
              type: 'warning',
              message: `片段 ${idx + 1} 确认不含题目（疑似答案/代码段），已跳过`,
            })
          }
        }

        results[idx] = { ok: true, questions: qs }
        setChunk(ck, qs)
        return true
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        return false
      }
    }

    // 并发池抽取
    let next = 0
    let doneCount = 0
    const totalFound = () => results.reduce((s, r) => s + r.questions.length, 0)
    const worker = async () => {
      while (next < chunkTotal) {
        throwIfAborted(signal)
        const idx = next++
        const ok = await runChunk(idx)
        doneCount++
        onEvent({
          type: 'progress',
          current: doneCount,
          total: chunkTotal,
          message: ok
            ? `片段 ${idx + 1}/${chunkTotal} 识别完成`
            : `片段 ${idx + 1}/${chunkTotal} 识别失败，稍后自动补跑`,
          found: totalFound(),
        })
        if (ok && results[idx].questions.length > 0) {
          onEvent({ type: 'questions', questions: results[idx].questions, batch: idx })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LLM_CONCURRENCY, chunkTotal) }, worker))

    // 多轮补跑失败片段
    let failed: number[] = []
    results.forEach((r, i) => {
      if (!r.ok) failed.push(i)
    })
    for (let round = 0; round < ROUND_WAITS.length && failed.length > 0; round++) {
      onEvent({
        type: 'stage',
        stage: `retry-${round + 1}`,
        message: `第 ${round + 1}/${ROUND_WAITS.length} 轮补跑 ${failed.length} 个失败片段（先等待 ${ROUND_WAITS[round] / 1000}s）…`,
      })
      await sleepInterruptible(ROUND_WAITS[round], signal)
      const still: number[] = []
      for (const idx of failed) {
        const ok = await runChunk(idx)
        if (ok) {
          onEvent({
            type: 'progress',
            current: chunkTotal - still.length,
            total: chunkTotal,
            message: `补跑成功：片段 ${idx + 1}`,
            found: totalFound(),
          })
          if (results[idx].questions.length > 0) {
            onEvent({ type: 'questions', questions: results[idx].questions, batch: idx })
          }
        } else {
          still.push(idx)
        }
      }
      failed = still
    }

    // 宽大处理：极小片段且无题目特征（如纯代码/答案尾部）反复失败时，视为合法空片段
    for (const idx of [...failed]) {
      const meta = chunkMeta(idx)
      if (meta.expected < 3 && !meta.questionish) {
        results[idx] = { ok: true, questions: [] }
        failed = failed.filter((x) => x !== idx)
        onEvent({ type: 'warning', message: `片段 ${idx + 1} 不含题目内容，已跳过` })
      }
    }

    // 合并 + 去重
    const merged: ParsedQuestion[] = results.flatMap((r) => (r.ok ? r.questions : []))
    const dedup1 = dedupeQuestions(merged)
    let all = dedup1.result

    // 题号精准补扫：对照全文题号找出漏识别的题，定向重抽
    onEvent({ type: 'stage', stage: 'supplement', message: '正在按题号扫描遗漏…' })
    try {
      const missing = findMissingNumbers(text, all)
      if (missing.length > 0) {
        onEvent({
          type: 'warning',
          message: `检测到 ${missing.length} 个题号未识别（第 ${missing
            .slice(0, 20)
            .map((m) => m.no)
            .join('、')}${missing.length > 20 ? '…' : ''}），正在定向补扫`,
        })
        const segText = missing
          .map((m) => text.slice(m.start, m.end).trim())
          .filter((s) => s.length > 10)
          .join('\n\n')
        if (segText) {
          const raw = await chatSafe(
            [
              { role: 'system', content: EXTRACT_SYSTEM },
              { role: 'user', content: `以下是之前遗漏的题目原文，请全部抽取：\n\n${segText}` },
            ],
            { guard, ...llm }
          )
          const parsed = extractJson<{ questions?: unknown[] }>(raw)
          const list = Array.isArray(parsed?.questions) ? parsed!.questions : []
          const qs: ParsedQuestion[] = []
          for (const item of list) {
            const nq = normalizeQuestion(item)
            if (nq) qs.push(nq)
          }
          if (qs.length > 0) {
            const dedup2 = dedupeQuestions([...all, ...qs])
            all = dedup2.result
            onEvent({ type: 'questions', questions: qs, batch: -1 })
          }
        }
      }
    } catch {
      onEvent({ type: 'warning', message: '补扫环节失败，已保留已识别部分' })
    }

    // 文末集中答案键回填：把 "1.C 2.A…"、"1.√ 2.×…" 映射到缺答案的题
    try {
      const keys = parseAnswerKeys(text)
      const keyApplied = applyAnswerKeys(all, keys)
      if (keyApplied > 0) {
        onEvent({
          type: 'warning',
          message: `已从文末答案表回填 ${keyApplied} 道题的答案`,
        })
      }
    } catch {
      /* 答案回填失败不影响主流程 */
    }

    // 终局：去重/补扫/答案回填后的最终数据
    onEvent({ type: 'questions-replace', questions: all })

    const failedChunks = failed.length
    const answered = all.filter((q) => q.answer.trim().length > 0).length

    // 核心规则：只有零失败完整成功才写整轮缓存；
    // 部分失败不缓存，避免重试永远拿到残缺数据（“识别少太多”的根因）
    if (failedChunks === 0) {
      setRound(runKey, all, fileName)
    } else {
      onEvent({
        type: 'warning',
        message: `仍有 ${failedChunks} 个片段未成功，本次结果不缓存；点击“重新识别”只补跑失败片段（已成功片段走缓存）`,
      })
    }

    onEvent({
      type: 'done',
      total: all.length,
      answered,
      failedChunks,
      supplement: 0,
      filtered: 0,
      fileName,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (e instanceof PipelineError) {
      onEvent({ type: 'error', message: e.message, fatal: true })
      throw e
    }
    const msg = e instanceof Error ? e.message : String(e)
    onEvent({ type: 'error', message: `识别失败：${msg}`, fatal: true })
    throw new PipelineError(`识别失败：${msg}`)
  }
}

function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
