/**
 * AI 识别用文本分块 —— 前后端共用。
 * 前端把长文本按题目边界切块后逐块调用 /api/parse-ai，
 * 避免单次请求处理太久触发网关超时（502）。
 */

/** 每块目标长度（字符）——需小于后端 MAX_CHUNK_CHARS=3200 */
const TARGET_LEN = 2400

/** 是否"像题号开头"的行，作为优先切块边界 */
function isBoundaryLine(line: string): boolean {
  return /^\s*(?:[一二三四五六七八九十]{1,3}\s*[、.．]|\d{1,3}\s*[\.、．)）]|[（(]\d{1,3}[)）])/.test(
    line,
  )
}

export function chunkTextForAi(text: string, targetLen = TARGET_LEN): string[] {
  if (text.length <= targetLen) return [text]

  const lines = text.split('\n')
  const chunks: string[] = []
  let buf = ''

  for (const line of lines) {
    if (buf && buf.length + line.length > targetLen && isBoundaryLine(line)) {
      chunks.push(buf)
      buf = line
    } else {
      buf += (buf ? '\n' : '') + line
    }
  }
  if (buf.trim()) chunks.push(buf)

  // 过长的单块硬切
  const finalChunks: string[] = []
  for (const c of chunks) {
    if (c.length <= targetLen * 1.3) {
      finalChunks.push(c)
    } else {
      for (let i = 0; i < c.length; i += targetLen) {
        finalChunks.push(c.slice(i, i + targetLen))
      }
    }
  }
  return finalChunks
}
