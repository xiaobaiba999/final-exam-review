// 测试：提取上传 docx 的文本 + 跑规则解析器，看结果
import mammoth from 'mammoth'
import fs from 'fs'
import { parseQuestions } from '../src/lib/parser/parse'

const FILE = '/home/z/my-project/upload/2026.10.14自学重修答疑题库及参考答案.docx'

async function main() {
  const buffer = fs.readFileSync(FILE)
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value
  fs.writeFileSync('/home/z/my-project/scripts/test-doc-text.txt', text)
  console.log('=== 文本长度:', text.length, '字符, 行数:', text.split('\n').length)
  console.log('=== 前 2500 字符 ===')
  console.log(text.slice(0, 2500))
  console.log('=== ...中间省略... ===')
  console.log(text.slice(-1500))

  const parsed = parseQuestions(text)
  console.log('\n=== 规则解析结果:', parsed.questions.length, '题 ===')
  const byType: Record<string, number> = {}
  for (const q of parsed.questions) {
    byType[q.type] = (byType[q.type] || 0) + 1
  }
  console.log('题型分布:', JSON.stringify(byType))
  const noAnswer = parsed.questions.filter((q) => !q.answer).length
  console.log('缺答案:', noAnswer, '题')
  console.log('\n=== 前 8 题 ===')
  for (const q of parsed.questions.slice(0, 8)) {
    console.log(`[${q.type}] ${q.stem.slice(0, 45)} | 答案:${q.answer} | 选项数:${q.options.length}`)
  }
}

main().catch(console.error)
