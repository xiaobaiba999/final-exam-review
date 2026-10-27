// 文档文本提取：docx / pdf / 纯文本（仅服务端）
import mammoth from 'mammoth'

export interface ExtractedDoc {
  text: string
  kind: 'docx' | 'pdf' | 'text'
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractText(fileName: string, buf: ArrayBuffer): Promise<ExtractedDoc> {
  const name = fileName.toLowerCase()
  if (name.endsWith('.docx') || name.endsWith('.doc')) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) })
    return { text: cleanText(value), kind: 'docx' }
  }
  if (name.endsWith('.pdf')) {
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await pdfExtract(pdf, { mergePages: true })
    return { text: cleanText(Array.isArray(text) ? text.join('\n') : text), kind: 'pdf' }
  }
  // txt / md 等
  return { text: cleanText(new TextDecoder('utf-8').decode(buf)), kind: 'text' }
}
