'use client'

// 复习模式（对标市面刷题软件）：
// - 统计总览：题库总量 / 错题本 / 收藏 / 累计正确率
// - 双模式：练习模式（答题判分，错题自动入本，答对自动出本）/ 背题模式（直接看答案解析）
// - 范围筛选：全部题 / 错题本 / 收藏；题型筛选；顺序/乱序
// - 进度自动保存：中途退出可「继续上次」；结果页可「只刷本轮错题」
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  Eye,
  Loader2,
  PenLine,
  RotateCcw,
  Shuffle,
  Star,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react'
import { StoredQuestion } from '@/lib/api-client'
import { useQuestionStore } from '@/lib/question-store'
import { QuestionType, TYPE_LABELS } from '@/lib/types'
import { userScopedKey } from '@/lib/user-store'

type Phase = 'setup' | 'session' | 'result'
type Mode = 'practice' | 'recite'
type Scope = 'all' | 'wrong' | 'starred'

interface SavedSession {
  v: 1
  mode: Mode
  typeFilter: 'all' | QuestionType
  scope: Scope
  order: 'seq' | 'rand'
  ids: string[]
  idx: number
  correct: number
  answered: number
  ts: number
}

// 会话存档键（按用户隔离）
const sessionKey = () => userScopedKey('exam_study_session')

function shuffleList<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
}

export function StudyMode({ onGoImport }: { onGoImport: () => void }) {
  const { toast } = useToast()
  const questions = useQuestionStore((s) => s.questions)
  const loading = useQuestionStore((s) => s.loading)
  const loadedOnce = useQuestionStore((s) => s.loadedOnce)
  const loadError = useQuestionStore((s) => s.error)
  const load = useQuestionStore((s) => s.load)
  const applyAction = useQuestionStore((s) => s.applyAction)

  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<Mode>('practice')
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all')
  const [scope, setScope] = useState<Scope>('all')
  const [order, setOrder] = useState<'seq' | 'rand'>('seq')

  const [queue, setQueue] = useState<StoredQuestion[]>([])
  const [idx, setIdx] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [selected, setSelected] = useState('')
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null)
  const [roundWrongIds, setRoundWrongIds] = useState<string[]>([])
  const [saved, setSaved] = useState<SavedSession | null>(null)
  const [starBusy, setStarBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // 读取「继续上次」存档（仅客户端）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey())
      if (!raw) return
      const s = JSON.parse(raw) as SavedSession
      if (s && s.v === 1 && Array.isArray(s.ids) && s.ids.length > 0) setSaved(s)
    } catch {
      /* ignore */
    }
  }, [])

  // 实时状态映射（星标/错题标记跟随全局 store）
  const liveMap = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  const pool = useMemo(
    () =>
      questions.filter((q) => {
        if (typeFilter !== 'all' && q.type !== typeFilter) return false
        if (scope === 'wrong' && !q.wrong) return false
        if (scope === 'starred' && !q.starred) return false
        return true
      }),
    [questions, typeFilter, scope]
  )

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { all: questions.length }
    for (const q of questions) m[q.type] = (m[q.type] ?? 0) + 1
    return m
  }, [questions])

  const scopeCounts = useMemo(
    () => ({
      all: questions.length,
      wrong: questions.filter((q) => q.wrong).length,
      starred: questions.filter((q) => q.starred).length,
    }),
    [questions]
  )

  const totalStats = useMemo(() => {
    let right = 0
    let wrong = 0
    for (const q of questions) {
      right += q.rightCount
      wrong += q.wrongCount
    }
    const total = right + wrong
    return { right, total, acc: total > 0 ? Math.round((right / total) * 100) : null }
  }, [questions])

  const clearSaved = useCallback(() => {
    try {
      localStorage.removeItem(sessionKey())
    } catch {
      /* ignore */
    }
    setSaved(null)
  }, [])

  const writeSaved = useCallback(
    (ids: string[], i: number, c: number, a: number, m: Mode) => {
      const s: SavedSession = {
        v: 1,
        mode: m,
        typeFilter,
        scope,
        order,
        ids,
        idx: i,
        correct: c,
        answered: a,
        ts: Date.now(),
      }
      try {
        localStorage.setItem(sessionKey(), JSON.stringify(s))
      } catch {
        /* ignore */
      }
    },
    [typeFilter, scope, order]
  )

  const begin = useCallback(
    (list: StoredQuestion[], m: Mode) => {
      if (list.length === 0) return
      const lst = [...list]
      if (order === 'rand') shuffleList(lst)
      setQueue(lst)
      setIdx(0)
      setCorrect(0)
      setAnswered(0)
      setSelected('')
      setInput('')
      setRevealed(m === 'recite')
      setLastCorrect(null)
      setRoundWrongIds([])
      setMode(m)
      setPhase('session')
      writeSaved(
        lst.map((q) => q.id),
        0,
        0,
        0,
        m
      )
    },
    [order, writeSaved]
  )

  const continueSaved = useCallback(() => {
    if (!saved) return
    const qs = saved.ids
      .map((id) => liveMap.get(id))
      .filter((q): q is StoredQuestion => Boolean(q))
    if (qs.length === 0) {
      clearSaved()
      toast({ title: '上次会话的题目已被删除，请重新开始' })
      return
    }
    setQueue(qs)
    setIdx(Math.min(saved.idx, qs.length - 1))
    setCorrect(saved.correct)
    setAnswered(saved.answered)
    setSelected('')
    setInput('')
    setRevealed(saved.mode === 'recite')
    setLastCorrect(null)
    setRoundWrongIds([])
    setMode(saved.mode)
    setTypeFilter(saved.typeFilter)
    setScope(saved.scope)
    setOrder(saved.order)
    setPhase('session')
  }, [saved, liveMap, clearSaved, toast])

  const current = queue[idx]
  // 星标/错题等实时状态以全局 store 为准（会话内的快照仅保底）
  const liveCurrent = current ? liveMap.get(current.id) ?? current : undefined

  // ---------- 作答 ----------
  const recordResult = useCallback(
    (ok: boolean) => {
      if (!current) return
      const a2 = answered + 1
      const c2 = correct + (ok ? 1 : 0)
      setAnswered(a2)
      if (ok) setCorrect(c2)
      if (!ok) setRoundWrongIds((w) => (w.includes(current.id) ? w : [...w, current.id]))
      // 错题本联动：答对自动出本、答错自动入本（乐观更新，失败静默提示）
      applyAction(current.id, ok ? 'markRight' : 'markWrong').catch(() => {
        toast({ title: '进度同步失败', description: '错题本状态可能未保存', variant: 'destructive' })
      })
      writeSaved(
        queue.map((q) => q.id),
        idx,
        c2,
        a2,
        mode
      )
    },
    [current, answered, correct, applyAction, toast, writeSaved, queue, idx, mode]
  )

  const submitChoice = useCallback(
    (key: string) => {
      if (!current || (revealed && lastCorrect !== null)) return
      setSelected(key)
      if (mode === 'recite') {
        setRevealed(true)
        return
      }
      // 无标准答案的客观题：转自评，不强行判错
      if (!current.answer) {
        setRevealed(true)
        return
      }
      const ok = key === current.answer
      setLastCorrect(ok)
      setRevealed(true)
      recordResult(ok)
    },
    [current, revealed, lastCorrect, mode, recordResult]
  )

  const submitSelfCheck = useCallback(
    (ok: boolean) => {
      if (lastCorrect !== null) return
      setLastCorrect(ok)
      recordResult(ok)
    },
    [lastCorrect, recordResult]
  )

  const next = useCallback(() => {
    const ni = idx + 1
    if (ni >= queue.length) {
      clearSaved()
      setPhase('result')
      return
    }
    setIdx(ni)
    setSelected('')
    setInput('')
    setRevealed(mode === 'recite')
    setLastCorrect(null)
    writeSaved(
      queue.map((q) => q.id),
      ni,
      correct,
      answered,
      mode
    )
  }, [idx, queue, mode, correct, answered, clearSaved, writeSaved])

  const prev = useCallback(() => {
    if (idx === 0) return
    const pi = idx - 1
    setIdx(pi)
    setSelected('')
    setInput('')
    setRevealed(true)
    setLastCorrect(null)
    writeSaved(
      queue.map((q) => q.id),
      pi,
      correct,
      answered,
      mode
    )
  }, [idx, queue, mode, correct, answered, writeSaved])

  const toggleStar = useCallback(async () => {
    if (!liveCurrent || starBusy) return
    setStarBusy(true)
    try {
      await applyAction(liveCurrent.id, liveCurrent.starred ? 'unstar' : 'star')
    } catch (e) {
      toast({
        title: '收藏操作失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setStarBusy(false)
    }
  }, [liveCurrent, starBusy, applyAction, toast])

  // ---------- 渲染 ----------
  if (loading && !loadedOnce) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
        加载中…
      </div>
    )
  }

  if (loadError && questions.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">题库加载失败：{loadError}</p>
        <Button onClick={() => void load()} variant="outline" className="min-h-11">
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          重试
        </Button>
      </div>
    )
  }

  // ===== 设置页 =====
  if (phase === 'setup') {
    return (
      <div className="space-y-4">
        {/* 统计总览 */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '总题数', value: String(questions.length), cls: '' },
            { label: '错题本', value: String(scopeCounts.wrong), cls: 'text-red-500' },
            { label: '收藏', value: String(scopeCounts.starred), cls: 'text-amber-500' },
            {
              label: '累计正确率',
              value: totalStats.acc === null ? '—' : `${totalStats.acc}%`,
              cls: 'text-emerald-600 dark:text-emerald-400',
            },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border bg-card px-2 py-3 text-center">
              <p className={`text-lg font-bold leading-tight ${t.cls}`}>{t.value}</p>
              <p className="mt-0.5 text-[11px] leading-none text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>
        {totalStats.total > 0 && (
          <p className="-mt-2 text-center text-[11px] text-muted-foreground">
            已累计刷题 {totalStats.total} 次 · 答对 {totalStats.right} 次
          </p>
        )}

        {/* 继续上次 */}
        {saved && (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <Target className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                上次{saved.mode === 'recite' ? '背题' : '练习'}到第 {Math.min(saved.idx + 1, saved.ids.length)}/
                {saved.ids.length} 题
              </p>
              <p className="text-xs text-muted-foreground">
                {saved.mode === 'practice' ? `已答 ${saved.answered} · 答对 ${saved.correct}` : '背题进行中'}
              </p>
            </div>
            <Button size="sm" className="min-h-9 shrink-0" onClick={continueSaved}>
              继续
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-9 shrink-0 text-muted-foreground"
              onClick={clearSaved}
            >
              放弃
            </Button>
          </div>
        )}

        {/* 模式 */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">模式</h3>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: 'practice' as Mode,
                  icon: PenLine,
                  title: '练习模式',
                  desc: '答题判分，错题自动入本',
                },
                {
                  key: 'recite' as Mode,
                  icon: BookOpenText,
                  title: '背题模式',
                  desc: '直接看答案与解析',
                },
              ] as const
            ).map(({ key, icon: Icon, title, desc }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                aria-pressed={mode === key}
                className={`rounded-lg border p-3 text-left transition-all active:scale-[0.99] ${
                  mode === key ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
              >
                <Icon className={`mb-1.5 h-5 w-5 ${mode === key ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 范围 */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">范围</h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: 'all' as Scope, label: '全部题' },
                { key: 'wrong' as Scope, label: '错题本' },
                { key: 'starred' as Scope, label: '收藏' },
              ] as const
            ).map(({ key, label }) => (
              <Button
                key={key}
                size="sm"
                variant={scope === key ? 'default' : 'outline'}
                onClick={() => setScope(key)}
                className="h-11 px-3.5"
              >
                {label}
                <span className="ml-1 text-xs opacity-70">{scopeCounts[key]}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* 题型 */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">题型</h3>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'single', 'judge', 'blank', 'short'] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={typeFilter === t ? 'default' : 'outline'}
                onClick={() => setTypeFilter(t)}
                className="h-11 px-3.5"
              >
                {t === 'all' ? '全部' : TYPE_LABELS[t]}
                <span className="ml-1 text-xs opacity-70">{typeCounts[t] ?? 0}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* 顺序 */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">顺序</h3>
          <div className="flex gap-2">
            <Button
              variant={order === 'seq' ? 'default' : 'outline'}
              onClick={() => setOrder('seq')}
              className="min-h-12 flex-1"
            >
              顺序
            </Button>
            <Button
              variant={order === 'rand' ? 'default' : 'outline'}
              onClick={() => setOrder('rand')}
              className="min-h-12 flex-1"
            >
              <Shuffle className="mr-2 h-4 w-4" aria-hidden />
              乱序
            </Button>
          </div>
        </div>

        {pool.length > 0 ? (
          <Button onClick={() => begin(pool, mode)} className="w-full min-h-12 text-base">
            {mode === 'recite' ? '开始背题' : '开始练习'}（{pool.length} 题）
          </Button>
        ) : (
          <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
            {questions.length === 0 ? (
              <>
                题库还是空的，先去
                <button className="mx-1 font-medium text-primary underline" onClick={onGoImport}>
                  导入题库
                </button>
                吧
              </>
            ) : scope !== 'all' ? (
              `「${scope === 'wrong' ? '错题本' : '收藏'}」暂无题目，去做几题试试`
            ) : (
              '该题型暂无题目'
            )}
          </div>
        )}
      </div>
    )
  }

  // ===== 结果页 =====
  if (phase === 'result') {
    const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card py-10 text-center">
        <Trophy className="h-12 w-12 text-amber-500" aria-hidden />
        <p className="text-lg font-semibold">{mode === 'recite' ? '背题完成' : '本轮完成'}</p>
        {mode === 'practice' ? (
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-2xl font-bold">{answered}</p>
              <p className="text-muted-foreground">已答</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{correct}</p>
              <p className="text-muted-foreground">答对</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{acc}%</p>
              <p className="text-muted-foreground">正确率</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">已背完 {queue.length} 题，建议再用练习模式自测</p>
        )}
        <div className="flex w-full max-w-xs flex-col gap-2 px-4">
          {mode === 'practice' && roundWrongIds.length > 0 && (
            <Button
              onClick={() =>
                begin(
                  roundWrongIds.map((id) => liveMap.get(id)).filter((q): q is StoredQuestion => Boolean(q)),
                  'practice'
                )
              }
              variant="secondary"
              className="min-h-11"
            >
              <XCircle className="mr-2 h-4 w-4 text-red-500" aria-hidden />
              只刷本轮错题（{roundWrongIds.length}）
            </Button>
          )}
          <Button onClick={() => begin(pool, mode)} className="min-h-11">
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
            再来一轮
          </Button>
          <Button variant="outline" onClick={() => setPhase('setup')} className="min-h-11">
            返回设置
          </Button>
        </div>
      </div>
    )
  }

  // ===== 会话页 =====
  if (!current) return null
  const options = current.options ?? []
  const progressPct = Math.round(((idx + (revealed ? 1 : 0)) / queue.length) * 100)

  return (
    <div className="space-y-4">
      {/* 进度 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{TYPE_LABELS[current.type as QuestionType] ?? current.type}</Badge>
          <span className="text-muted-foreground">
            第 {idx + 1}/{queue.length} 题
          </span>
          {mode === 'practice' && (
            <span className="ml-auto text-xs text-muted-foreground">
              答对 {correct}/{answered}
            </span>
          )}
        </div>
        <Progress value={progressPct} aria-label="复习进度" />
      </div>

      {/* 题目卡片 */}
      <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-base leading-relaxed">{current.stem}</p>
          <button
            onClick={() => void toggleStar()}
            disabled={starBusy}
            aria-label={liveCurrent?.starred ? '取消收藏' : '收藏本题'}
            aria-pressed={liveCurrent?.starred}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 disabled:opacity-50"
          >
            <Star
              className={`h-5 w-5 ${liveCurrent?.starred ? 'fill-amber-400 text-amber-500' : ''}`}
              aria-hidden
            />
          </button>
        </div>

        {current.type === 'single' && options.length > 0 && (
          <div className="grid gap-2">
            {options.map((o) => {
              const isPicked = selected === o.key
              const isAnswer = o.key === current.answer
              const showState = revealed && (isPicked || isAnswer)
              return (
                <button
                  key={o.key}
                  disabled={revealed}
                  onClick={() => submitChoice(o.key)}
                  className={`min-h-12 rounded-lg border px-3 py-2.5 text-left text-sm transition-all active:scale-[0.99] ${
                    showState
                      ? isAnswer
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                        : 'border-red-400 bg-red-50 dark:bg-red-950/40'
                      : 'hover:border-primary/60 hover:bg-accent'
                  } ${revealed && !showState ? 'opacity-60' : ''}`}
                >
                  <span className="mr-2 font-semibold">{o.key}.</span>
                  {o.text}
                  {showState && isAnswer && (
                    <CheckCircle2 className="ml-2 inline h-4 w-4 text-emerald-600" aria-hidden />
                  )}
                  {showState && isPicked && !isAnswer && (
                    <XCircle className="ml-2 inline h-4 w-4 text-red-500" aria-hidden />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {current.type === 'judge' && (
          <div className="grid grid-cols-2 gap-2">
            {['正确', '错误'].map((v) => {
              const isPicked = selected === v
              const isAnswer = current.answer === v
              const showState = revealed && (isPicked || isAnswer)
              return (
                <button
                  key={v}
                  disabled={revealed}
                  onClick={() => submitChoice(v)}
                  className={`min-h-14 rounded-lg border text-sm transition-all active:scale-[0.99] ${
                    showState
                      ? isAnswer
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                        : 'border-red-400 bg-red-50 dark:bg-red-950/40'
                      : 'hover:border-primary/60 hover:bg-accent'
                  } ${revealed && !showState ? 'opacity-60' : ''}`}
                >
                  {v}
                </button>
              )
            })}
          </div>
        )}

        {(current.type === 'blank' || current.type === 'short') && (
          <div className="space-y-2">
            {!revealed ? (
              <>
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={current.type === 'blank' ? '输入你的答案…' : '写下你的答案要点…'}
                  className="min-h-28"
                  aria-label="作答区"
                />
                <Button
                  variant="outline"
                  onClick={() => setRevealed(true)}
                  className="w-full min-h-11"
                >
                  <Eye className="mr-2 h-4 w-4" aria-hidden />
                  显示答案
                </Button>
              </>
            ) : (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">参考答案</p>
                <p className="text-sm font-medium leading-relaxed">
                  {current.answer || '（原文无答案，可对照解析理解）'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 判分结果 / 自评 */}
        {revealed && mode === 'practice' && (
          lastCorrect !== null ? (
            <div
              className={`rounded-lg border p-3 text-sm ${
                lastCorrect
                  ? 'border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-red-400/50 bg-red-50 dark:bg-red-950/40'
              }`}
            >
              <p
                className={`font-medium ${
                  lastCorrect ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                }`}
              >
                {lastCorrect ? '回答正确' : '回答错误'}
                {current.answer && (
                  <span className="ml-2 font-normal text-foreground">正确答案：{current.answer}</span>
                )}
              </p>
              {current.explanation && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">解析：</span>
                  {current.explanation}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border p-3 text-sm">
              {selected && current.type !== 'blank' && current.type !== 'short' && (
                <p className="text-muted-foreground">
                  你选择了：<span className="font-medium text-foreground">{selected}</span>
                  {!current.answer && '（本题无标准答案，请自评）'}
                </p>
              )}
              {(current.type === 'single' || current.type === 'judge') && current.answer && (
                <p className="mt-1 text-muted-foreground">
                  参考答案：<span className="font-medium text-foreground">{current.answer}</span>
                </p>
              )}
              {current.explanation && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">解析：</span>
                  {current.explanation}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-10 flex-1"
                  onClick={() => submitSelfCheck(true)}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-600" aria-hidden />
                  我答对了
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-10 flex-1"
                  onClick={() => submitSelfCheck(false)}
                >
                  <XCircle className="mr-1.5 h-4 w-4 text-red-500" aria-hidden />
                  我答错了
                </Button>
              </div>
            </div>
          )
        )}

        {/* 背题模式：答案+解析直接展示 */}
        {revealed && mode === 'recite' && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-3 text-sm dark:bg-emerald-950/30">
            <p className="font-medium text-emerald-700 dark:text-emerald-400">
              答案：{current.answer || '（原文无答案，对照解析理解）'}
            </p>
            {current.explanation && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">解析：</span>
                {current.explanation}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 操作区 */}
      <div className="flex gap-2">
        {mode === 'recite' && idx > 0 && (
          <Button variant="outline" onClick={prev} className="min-h-12 flex-1">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
            上一题
          </Button>
        )}
        {(revealed || mode === 'recite') && (
          <Button onClick={next} className="min-h-12 flex-1 text-base">
            {idx + 1 >= queue.length ? '完成' : '下一题'}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
