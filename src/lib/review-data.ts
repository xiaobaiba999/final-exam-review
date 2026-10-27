// 复习数据文件（导出/导入用）：题库 + 学习进度的可迁移快照
// 换设备流程：旧设备「导出文件」→ 新设备「导入文件」
import { StoredQuestion } from './question-store'

export interface ReviewData {
  version: 1
  app: 'exam-review'
  exportedAt: string
  questions: StoredQuestion[]
}

export function buildReviewData(questions: StoredQuestion[]): ReviewData {
  return {
    version: 1,
    app: 'exam-review',
    exportedAt: new Date().toISOString(),
    questions,
  }
}
