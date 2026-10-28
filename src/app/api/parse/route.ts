import { NextRequest, NextResponse } from 'next/server'
import { extractTextFromFile } from '@/lib/parser/extract'
import { parseQuestions } from '@/lib/parser/parse'
import type { ParseResult } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/parse
 * - multipart/form-data: file=<File>  上传文件解析
 * - application/json:    { text, fileName? } 直接粘贴文本解析
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let text = ''
    let fileName = '粘贴的文本'
    let notices: string[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: '缺少文件' }, { status: 400 })
      }
      const extracted = await extractTextFromFile(file)
      text = extracted.text
      notices = extracted.notices
      fileName = file.name
    } else {
      const body = await req.json()
      if (!body.text || typeof body.text !== 'string') {
        return NextResponse.json({ error: '缺少文本内容' }, { status: 400 })
      }
      text = body.text
      fileName = body.fileName || '粘贴的文本'
    }

    const { questions, notices: parseNotices } = parseQuestions(text)
    notices = [...notices, ...parseNotices]

    const result: ParseResult = {
      text,
      fileName,
      questions,
      notices,
      stats: {
        chars: text.replace(/\s/g, '').length,
        lines: text.split('\n').length,
      },
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '解析失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
