// 复现测试：上传真实题库文档，统计 SSE 事件与题数（对账 96 题标准）
// 用法: bun tests/repro-parse.ts [force]
const DOC = '/home/z/my-project/upload/2026.10.14自学重修答疑题库及参考答案.docx'
const BASE = 'http://localhost:3000'

async function main() {
  const force = process.argv[2] === 'force'
  const f = Bun.file(DOC)
  const form = new FormData()
  form.append('file', f, f.name)
  if (force) form.append('force', '1')

  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/parse-ai-stream`, { method: 'POST', body: form })
  console.log('HTTP', res.status)
  if (!res.ok || !res.body) {
    console.log(await res.text())
    process.exit(1)
  }

  const counts: Record<string, number> = {}
  let questions: Array<{ type: string; stem: string; answer: string }> = []
  let doneInfo: Record<string, unknown> | null = null
  let buf = ''

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      try {
        const ev = JSON.parse(line.slice(5).trim())
        counts[ev.type] = (counts[ev.type] ?? 0) + 1
        if (ev.type === 'questions') questions = questions.concat(ev.questions)
        if (ev.type === 'questions-replace') questions = ev.questions
        if (ev.type === 'done') doneInfo = ev
        if (ev.type === 'warning') console.log('WARN:', ev.message)
        if (ev.type === 'error') console.log('ERROR:', ev.message)
      } catch {
        /* skip */
      }
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log('--- 事件统计 ---')
  console.log(JSON.stringify(counts))
  console.log('--- 结果 ---')
  console.log('收到题目事件数:', questions.length)
  if (doneInfo) {
    console.log('DONE:', JSON.stringify(doneInfo))
  }
  const byType: Record<string, number> = {}
  for (const q of questions) byType[q.type] = (byType[q.type] ?? 0) + 1
  console.log('按题型:', JSON.stringify(byType))
  const withAnswer = questions.filter((q) => q.answer).length
  console.log(`有答案: ${withAnswer}/${questions.length}`)
  // 题号对账
  const nos = questions
    .map((q) => q.stem.match(/^\s*(\d{1,3})\s*[.、,，．)）:：]/))
    .filter(Boolean)
    .map((m) => parseInt(m![1], 10))
  const missing: number[] = []
  if (nos.length > 0) {
    const set = new Set(nos)
    for (let i = 1; i <= Math.max(...nos); i++) if (!set.has(i)) missing.push(i)
  }
  console.log('缺失题号:', missing.length > 0 ? missing.join(',') : '无')
  console.log(`耗时 ${secs}s`)
}

void main()
