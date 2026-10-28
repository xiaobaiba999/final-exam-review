// AI 识别题库（SSE 流式）
// 架构：docx/pdf 提取 -> 按题号边界分块 -> 并发 LLM 抽取 -> 题号精准补扫 -> 去重/校验 -> done
// 可靠性：片段缓存(断点续跑) / 整轮缓存(仅完整成功) / 进行中去重+事件回放 / 多轮补跑 / 限流守卫
import { NextRequest } from 'next/server'
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
import {
  contentKey,
  chunkKey,
  getChunk,
  setChunk,
  getRound,
  setRound,
  dropRound,
  getInflight,
  registerInflight,
  RoundBroadcast,
} from '@/lib/parse-cache'
import { AiStreamEvent, ParsedQuestion } from '@/lib/types'

export const runtime = 'nodejs'
// 云平台（如 Vercel Hobby）单次函数时长上限常见为 60s；
// 超时时前端会自动重连，已成功片段走片段缓存无缝续跑。
export const maxDuration = 60

const LLM_CONCURRENCY = 3
const ROUND_WAITS = [30_000, 60_000, 60_000]
const WAIT_INFLIGHT_TIMEOUT = 420_000
// SSE 心跳间隔：防止中间代理对静默连接超时断开
const SSE_HEARTBEAT_MS = 15_000

const EXTRACT_SYSTEM = `你是题库数字化引擎。从给定文本片段中逐题抽取全部题目，规则：
1. 逐题完整抽取：一道都不能漏、不能合并、不能改写或缩写题干。
2. 题干必须保留原文完整文字，包括原文自带的题号前缀（如 "12."）；原文没有编号的题目绝对不要自行添加编号。
3. 单选题 type:"single"，options 为 [{"key":"A","text":"选项原文"},...]，answer 为正确选项字母如 "C"。
4. 判断题 type:"judge"，answer 只能是 "正确" 或 "错误"。
5. 填空题 type:"blank"，answer 依原文填空内容；简答题/问答/论述 type:"short"，answer 为参考答案。
6. 题干、选项、答案都必须来自片段原文。若片段本身没有题目（例如只有答案表、代码或说明文字），输出 {"questions":[]}。
7. 片段开头或结尾可能被截断：无法辨认完整题干的残缺题跳过，其余必须输出。
8. 只输出 JSON：{"questions":[...]}，不要任何解释文字。`

export async function POST(req: NextRequest) {
  let fileName = ''
  try {
    const form = await req.formData()
    const file = form.get('file')
    const force = form.get('force') === '1'
    if (!(file instanceof File)) {
      return Response.json({ error: '缺少文件' }, { status: 400 })
    }
    fileName = file.name || '未命名文档'
    if (file.size > 30 * 1024 * 1024) {
      return Response.json({ error: '文件过大（上限 30MB）' }, { status: 400 })
    }
    const buf = await file.arrayBuffer()
    const runKey = contentKey(fileName, buf)
    if (force) dropRound(runKey)

    // 1) 整轮缓存命中（仅完整成功的结果会进入缓存）
    const cached = force ? null : getRound(runKey)
    if (cached) {
      console.log(`[parse-ai] REPLAY ${JSON.stringify(fileName)} total=${cached.total}`)
      return sseResponse(
        (async function* () {
          // 明确告知用户当前是缓存回放，避免「界面不能刷新/没反应」的困惑；
          // 用 warning 事件承载（stage 会被快照内后续事件覆盖，warning 会保留展示）
          yield {
            type: 'warning',
            message: `已从缓存直接载入上次完整识别结果（共 ${cached.total} 题）；如需重新识别请点「强制重识（不用缓存）」`,
          } as AiStreamEvent
          for (const ev of cached.events) yield ev
        })()
      )
    }

    // 2) 同文档识别进行中：挂到同一广播上回放
    const busy = getInflight(runKey)
    if (busy) {
      console.log(`[parse-ai] WAIT ${JSON.stringify(fileName)}（同文档识别进行中）`)
      return sseResponse(waitAndReplay(busy))
    }

    // 3) 全新识别
    const broadcast = registerInflight(runKey)
    runPipeline(fileName, buf, runKey, broadcast, force).catch((e) => {
      console.error(`[parse-ai] PIPELINE CRASH ${JSON.stringify(fileName)}`, e)
      broadcast.push({ type: 'error', message: '识别管线异常，请重试', fatal: true })
      broadcast.close()
    })

    return sseResponse(broadcast.subscribe())
  } catch (e) {
    console.error('[parse-ai] BAD REQUEST', e)
    return Response.json({ error: '请求解析失败，请重新上传' }, { status: 400 })
  }
}

// ---------- SSE 输出 ----------
// 事件间隙发送心跳注释帧，避免代理对静默连接超时断开
function sseResponse(gen: AsyncGenerator<AiStreamEvent | null>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const next = gen.next()
          const result = await Promise.race([
            next.then((v) => ({ kind: 'ev' as const, v })),
            new Promise<{ kind: 'hb' }>((r) => setTimeout(() => r({ kind: 'hb' }), SSE_HEARTBEAT_MS)),
          ])
          if (result.kind === 'hb') {
            controller.enqueue(encoder.encode(`: hb\n\n`))
            continue
          }
          const ev = result.v
          if (ev.done || ev.value === null) break
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev.value)}\n\n`))
          if (ev.value.type === 'done') break
        }
      } catch {
        // 客户端断开
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function* waitAndReplay(busy: RoundBroadcast) {
  const deadline = Date.now() + WAIT_INFLIGHT_TIMEOUT
  let yielded = 0
  for await (const ev of busy.subscribe()) {
    if (ev === null) {
      if (yielded === 0) {
        // 挂上时广播恰好已结束（竞态）：明确报错让前端自动重连
        yield { type: 'error', message: '同文档识别刚结束，正在重新发起…' } as AiStreamEvent
      } else if (Date.now() > deadline) {
        yield { type: 'error', message: '等待进行中的同文档识别超时，请稍后重试' } as AiStreamEvent
      }
      return
    }
    yielded++
    yield ev
  }
}

// ---------- 主管线 ----------
async function runPipeline(
  fileName: string,
  buf: ArrayBuffer,
  runKey: string,
  broadcast: RoundBroadcast,
  force = false
) {
  const t0 = Date.now()
  const guard = createRateGuard()
  // 事件快照：广播的同时留档，完整成功时写入整轮缓存
  const snapshot: AiStreamEvent[] = []
  const push = (ev: AiStreamEvent) => {
    snapshot.push(ev)
    broadcast.push(ev)
  }
  let filtered = 0
  let supplement = 0

  try {
    push({ type: 'stage', stage: 'extract', message: '正在解析文档…' })
    const doc = await extractText(fileName, buf)
    const text = doc.text
    if (text.length < 30) {
      push({
        type: 'error',
        message: '文档内容过少或无法提取文本（扫描版 PDF 暂不支持），请确认文档为可复制的文字版',
        fatal: true,
      })
      broadcast.close()
      return
    }

    const ranges = chunkByQuestion(text)
    const chunkTotal = ranges.length
    console.log(
      `[parse-ai] START ${JSON.stringify(fileName)} chars=${text.length} kind=${doc.kind} chunks=${chunkTotal}`
    )
    push({
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
      const meta = chunkMeta(idx)
      const seg = meta.seg
      const ck = chunkKey(runKey, seg, doc.kind)
      // force 时绕过片段缓存：作为真正的逃生门，所有片段全部重新抽取
      const hit = force ? null : getChunk(ck)
      if (hit) {
        results[idx] = { ok: true, questions: hit as ParsedQuestion[] }
        return true
      }
      const parseQs = (raw: string): ParsedQuestion[] => {
        const parsed = extractJson<{ questions?: unknown[] }>(raw)
        const list = Array.isArray(parsed?.questions) ? parsed!.questions : []
        const qs: ParsedQuestion[] = []
        for (const item of list) {
          const nq = normalizeQuestion(item)
          if (nq) qs.push(nq)
          else filtered++
        }
        return qs
      }
      try {
        const raw = await chatSafe(
          [
            { role: 'system', content: EXTRACT_SYSTEM },
            { role: 'user', content: `文本片段（第 ${idx + 1}/${chunkTotal} 段）：\n\n${seg}` },
          ],
          { guard }
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
                { guard }
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
              { guard }
            )
            qs = parseQs(raw2)
          } catch {
            /* ignore */
          }
          if (qs.length === 0) {
            push({
              type: 'warning',
              message: `片段 ${idx + 1} 确认不含题目（疑似答案/代码段），已跳过`,
            })
          }
        }

        results[idx] = { ok: true, questions: qs }
        setChunk(ck, qs)
        return true
      } catch {
        return false
      }
    }

    // 并发池抽取
    let next = 0
    let doneCount = 0
    const totalFound = () => results.reduce((s, r) => s + r.questions.length, 0)
    const worker = async () => {
      while (next < chunkTotal) {
        const idx = next++
        const ok = await runChunk(idx)
        push({
          type: 'progress',
          current: ++doneCount,
          total: chunkTotal,
          message: ok
            ? `片段 ${idx + 1}/${chunkTotal} 识别完成`
            : `片段 ${idx + 1}/${chunkTotal} 识别失败，稍后自动补跑`,
          found: totalFound(),
        })
        if (ok && results[idx].questions.length > 0) {
          push({ type: 'questions', questions: results[idx].questions, batch: idx })
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
      push({
        type: 'stage',
        stage: `retry-${round + 1}`,
        message: `第 ${round + 1}/${ROUND_WAITS.length} 轮补跑 ${failed.length} 个失败片段（先等待 ${ROUND_WAITS[round] / 1000}s）…`,
      })
      await new Promise<void>((r) => setTimeout(r, ROUND_WAITS[round]))
      const still: number[] = []
      for (const idx of failed) {
        const ok = await runChunk(idx)
        if (ok) {
          push({
            type: 'progress',
            current: chunkTotal - still.length,
            total: chunkTotal,
            message: `补跑成功：片段 ${idx + 1}`,
            found: totalFound(),
          })
          if (results[idx].questions.length > 0) {
            push({ type: 'questions', questions: results[idx].questions, batch: idx })
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
        push({ type: 'warning', message: `片段 ${idx + 1} 不含题目内容，已跳过` })
      }
    }

    // 合并 + 去重
    const merged: ParsedQuestion[] = results.flatMap((r) => (r.ok ? r.questions : []))
    const dedup1 = dedupeQuestions(merged)
    let all = dedup1.result
    filtered += dedup1.removed

    // 题号精准补扫：对照全文题号找出漏识别的题，定向重抽
    push({ type: 'stage', stage: 'supplement', message: '正在按题号扫描遗漏…' })
    try {
      const missing = findMissingNumbers(text, all)
      if (missing.length > 0) {
        push({
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
            { guard }
          )
          const parsed = extractJson<{ questions?: unknown[] }>(raw)
          const list = Array.isArray(parsed?.questions) ? parsed!.questions : []
          const qs: ParsedQuestion[] = []
          for (const item of list) {
            const nq = normalizeQuestion(item)
            if (nq) qs.push(nq)
            else filtered++
          }
          if (qs.length > 0) {
            const dedup2 = dedupeQuestions([...all, ...qs])
            supplement = Math.max(0, dedup2.result.length - all.length)
            all = dedup2.result
            push({ type: 'questions', questions: qs, batch: -1 })
          }
        }
      }
    } catch {
      push({ type: 'warning', message: '补扫环节失败，已保留已识别部分' })
    }

    // 文末集中答案键回填：把 "1.C 2.A…"、"1.√ 2.×…" 映射到缺答案的题
    try {
      const keys = parseAnswerKeys(text)
      const keyApplied = applyAnswerKeys(all, keys)
      if (keyApplied > 0) {
        push({
          type: 'warning',
          message: `已从文末答案表回填 ${keyApplied} 道题的答案`,
        })
      }
    } catch {
      /* 答案回填失败不影响主流程 */
    }

    // 终局替换：确保客户端拿到的是去重/补扫/答案回填之后的最终数据
    push({ type: 'questions-replace', questions: all })

    const failedChunks = failed.length
    const answered = all.filter((q) => q.answer.trim().length > 0).length
    const secs = ((Date.now() - t0) / 1000).toFixed(1)

    // 核心规则：只有零失败完整成功才写整轮缓存；
    // 部分失败不缓存，避免重试永远拿到残缺数据（“识别少太多”的根因）
    if (failedChunks === 0) {
      setRound(runKey, snapshot, all.length)
    } else {
      // 警告必须在 done 之前推（客户端收到 done 即结束读取）
      push({
        type: 'warning',
        message: `仍有 ${failedChunks} 个片段未成功，本次结果不缓存；点击“重新识别”只补跑失败片段（已成功片段走缓存）`,
      })
    }

    push({
      type: 'done',
      total: all.length,
      answered,
      failedChunks,
      supplement,
      filtered,
      fileName,
    })
    console.log(
      `[parse-ai] DONE ${JSON.stringify(fileName)} total=${all.length} answered=${answered} supplement=${supplement} failedChunks=${failedChunks} secs=${secs}`
    )
    broadcast.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[parse-ai] FAIL ${JSON.stringify(fileName)} ${JSON.stringify(msg)} secs=${((Date.now() - t0) / 1000).toFixed(1)}`
    )
    push({ type: 'error', message: `识别失败：${msg}`, fatal: true })
    broadcast.close()
  }
}
