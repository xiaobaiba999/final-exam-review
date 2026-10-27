// 文档文本提取（浏览器版）：docx / pdf / 纯文本
// docx 使用 mammoth 浏览器 bundle（动态 import 懒加载，不占首屏体积）
// pdf 使用 unpdf（纯 JS 的 pdf.js 封装，浏览器可直接运行）
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
    // mammoth 浏览器版：UMD bundle，extractRawText 接受 { arrayBuffer }
    const mammoth = (await import('mammoth/mammoth.browser')) as {
      extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
    }
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
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
