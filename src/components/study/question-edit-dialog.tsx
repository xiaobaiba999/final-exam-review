'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ORDER,
  type QuestionOption,
  type QuestionType,
} from '@/lib/types'

/** 编辑表单可读写的题目字段（ParsedQuestion 与 QuestionRecord 共用） */
export interface EditableQuestion {
  type: QuestionType
  stem: string
  options: QuestionOption[]
  answer: string
  explanation: string
}

interface QuestionEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** 打开时的初始值；为 null 时不渲染表单内容 */
  initial: EditableQuestion | null
  /** 保存回调：抛错时对话框保持打开（由调用方负责 toast 提示） */
  onSave: (data: EditableQuestion) => Promise<void> | void
}

const OPTION_LETTERS = 'ABCDEFGH'.split('')
const MAX_OPTIONS = 8

/** 题目编辑对话框（导入向导预览与题库浏览共用） */
export function QuestionEditDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSave,
}: QuestionEditDialogProps) {
  const [type, setType] = useState<QuestionType>('OTHER')
  const [stem, setStem] = useState('')
  const [options, setOptions] = useState<QuestionOption[]>([])
  const [answer, setAnswer] = useState('')
  const [explanation, setExplanation] = useState('')
  const [saving, setSaving] = useState(false)

  // 每次打开时用 initial 重置表单（对话框关闭时调用方会清空选中题，重开即重置）
  useEffect(() => {
    if (open && initial) {
      setType(initial.type)
      setStem(initial.stem)
      setOptions(initial.options.map((o) => ({ ...o })))
      setAnswer(initial.answer)
      setExplanation(initial.explanation)
      setSaving(false)
    }
    // 仅在 open 变化时重置，避免父组件重渲染导致用户输入被覆盖
  }, [open])

  const addOption = () => {
    setOptions((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev
      return [...prev, { label: OPTION_LETTERS[prev.length], text: '' }]
    })
  }

  const removeOption = (index: number) => {
    setOptions((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((o, i) => ({ ...o, label: OPTION_LETTERS[i] })),
    )
  }

  const updateOptionText = (index: number, text: string) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, text } : o)),
    )
  }

  const handleSave = async () => {
    if (!stem.trim() || saving) return
    setSaving(true)
    try {
      await onSave({
        type,
        stem: stem.trim(),
        options: options
          .map((o) => ({ label: o.label, text: o.text.trim() }))
          .filter((o) => o.text.length > 0),
        answer: answer.trim(),
        explanation: explanation.trim(),
      })
      onOpenChange(false)
    } catch {
      // 保存失败：保持对话框打开，错误提示由调用方 toast
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scrollbar sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>修改后记得保存，题目内容将同步更新。</DialogDescription>
        </DialogHeader>

        {initial && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="qe-type">题型</Label>
              <Select value={type} onValueChange={(v) => setType(v as QuestionType)}>
                <SelectTrigger id="qe-type" className="w-full" aria-label="选择题型">
                  <SelectValue placeholder="选择题型" />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {QUESTION_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="qe-stem">题干</Label>
              <Textarea
                id="qe-stem"
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                rows={3}
                placeholder="题目内容"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>选项（{options.length}/{MAX_OPTIONS}）</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                  disabled={options.length >= MAX_OPTIONS}
                >
                  <Plus className="size-4" />
                  添加选项
                </Button>
              </div>
              {options.length === 0 && (
                <p className="text-muted-foreground text-sm">暂无选项（非选择题可留空）</p>
              )}
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={o.label + i} className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-stone-300 text-sm font-semibold text-stone-500 dark:border-zinc-600 dark:text-zinc-400">
                      {o.label}
                    </span>
                    <Input
                      value={o.text}
                      onChange={(e) => updateOptionText(i, e.target.value)}
                      placeholder={`选项 ${o.label} 内容`}
                      aria-label={`选项 ${o.label} 内容`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(i)}
                      disabled={saving}
                      aria-label={`删除选项 ${o.label}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="qe-answer">答案</Label>
              <Input
                id="qe-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="如：A、ABC、对、或文本答案"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="qe-explanation">解析（可选）</Label>
              <Textarea
                id="qe-explanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={3}
                placeholder="题目解析 / 答案说明"
              />
            </div>
          </div>
        )}

        <Separator />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !stem.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
