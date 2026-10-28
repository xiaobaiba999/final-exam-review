import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  QUESTION_TYPE_BADGE,
  QUESTION_TYPE_LABEL,
  type QuestionType,
} from '@/lib/types'

interface QuestionTypeBadgeProps {
  type: QuestionType
  className?: string
  /** 传入时覆盖默认的题型文字（如显示「单选题 ×12」） */
  children?: ReactNode
}

/** 题型徽章：按 QUESTION_TYPE_LABEL / QUESTION_TYPE_BADGE 渲染统一配色 */
export function QuestionTypeBadge({ type, className, children }: QuestionTypeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium whitespace-nowrap', QUESTION_TYPE_BADGE[type], className)}
    >
      {children ?? QUESTION_TYPE_LABEL[type]}
    </Badge>
  )
}
