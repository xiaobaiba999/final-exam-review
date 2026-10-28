import mammoth from 'mammoth'
import WordExtractor from 'word-extractor'
import { MAX_FILE_SIZE, SUPPORTED_EXTS } from '../types'

export interface ExtractResult {
  text: string
  /** 警告信息（如扫描件、空文档） */
  notices: string[]
}

/**
 * 从上传的文件中提取纯文本
 * 支持 .docx / .doc / .pdf / .txt
 */
export async function extractTextFromFile(
  file: File,
): Promise<ExtractResult> {
  const notices: string[] = []

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    )
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!SUPPORTED_EXTS.includes(ext as (typeof SUPPORTED_EXTS)[number])) {
    throw new Error(
      `暂不支持 .${ext} 格式，请上传 Word（.docx / .doc）、PDF 或 TXT 文件`,
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let text = ''

  switch (ext) {
    case 'docx': {
      try {
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
      } catch {
        // 少数 .docx 实际是旧 .doc 格式，回退到 word-extractor
        try {
          const extractor = new WordExtractor()
          const doc = await extractor.extract(buffer)
          text = doc.getBody()
        } catch {
          throw new Error('无法解析该 Word 文档，文件可能已损坏')
        }
      }
      break
    }
    case 'doc': {
      try {
        const extractor = new WordExtractor()
        const doc = await extractor.extract(buffer)
        text = doc.getBody()
      } catch {
        throw new Error('无法解析该 .doc 文档，请尝试另存为 .docx 后重新上传')
      }
      break
    }
    case 'pdf': {
      text = await extractPdfText(buffer)
      break
    }
    case 'txt': {
      text = decodeTextBuffer(buffer)
      break
    }
  }

  const visibleChars = text.replace(/\s/g, '').length
  if (visibleChars < 10) {
    throw new Error(
      '未能从文件中提取到文字。若为扫描版 PDF / 图片型文档，请改用文字版 Word 文档或直接粘贴文本',
    )
  }
  if (ext === 'pdf' && visibleChars < file.size / 500) {
    notices.push(
      '该 PDF 提取到的文字较少，可能是扫描件或包含图片题图，建议核对识别结果',
    )
  }

  return { text, notices }
}

/** PDF 文本提取（unpdf） */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: true })
    return Array.isArray(text) ? text.join('\n\n') : text
  } catch {
    throw new Error(
      '无法解析该 PDF 文件，文件可能已加密或损坏，请尝试用 Word 版题库',
    )
  }
}

/** TXT 多编码尝试解码 */
function decodeTextBuffer(buffer: Buffer): string {
  const candidates = ['utf-8', 'gb18030', 'big5']
  for (const enc of candidates) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true })
      const decoded = decoder.decode(buffer)
      // 若出现大量替换符则视为解码失败
      if (!decoded.includes('\uFFFD')) return decoded
    } catch {
      // 尝试下一种编码
    }
  }
  return buffer.toString('utf-8')
}
