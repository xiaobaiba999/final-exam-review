'use client'

// 登录门：未登录时整屏显示（注册/登录），登录后渲染 children
// 本地账号体系：数据按用户隔离存本机，换设备用导出/导入文件迁移
import { useState } from 'react'
import { BookOpen, Eye, EyeOff, Loader2, LogIn, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUserStore } from '@/lib/user-store'

export function LoginGate({ children }: { children: React.ReactNode }) {
  const current = useUserStore((s) => s.current)
  const users = useUserStore((s) => s.users)
  const register = useUserStore((s) => s.register)
  const login = useUserStore((s) => s.login)

  const [mode, setMode] = useState<'login' | 'register'>(() => (users.length === 0 ? 'register' : 'login'))
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (current) return <>{children}</>

  const submit = async () => {
    setErr('')
    setBusy(true)
    try {
      if (mode === 'register') await register(name, pass)
      else await login(name, pass)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm">
        {/* 品牌 */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <BookOpen className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold">期末复习助手</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              每人一个账号，题库、进度、错题本互相独立
              <br />
              数据只存在本设备浏览器里，换设备可在设置中导出/导入迁移
            </p>
          </div>
        </div>

        {/* 卡片 */}
        <div className="rounded-2xl border bg-background p-5 shadow-sm">
          {/* 登录/注册切换 */}
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="登录或注册">
            {(['register', 'login'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m)
                  setErr('')
                }}
                className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'register' ? <UserPlus className="h-4 w-4" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
                {m === 'register' ? '注册新用户' : '登录'}
              </button>
            ))}
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="login-name">昵称</Label>
              <Input
                id="login-name"
                placeholder={mode === 'register' ? '给自己起个名字，如：小明' : '输入你的昵称'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoComplete="off"
                className="h-11"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-pass">
                密码
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  （{mode === 'register' ? '可不设' : '没设过就留空'}）
                </span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="login-pass"
                  type={showPass ? 'text' : 'password'}
                  placeholder="至少 4 位"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="off"
                  className="h-11"
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={showPass ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {err && (
              <p className="text-sm text-destructive" role="alert">
                {err}
              </p>
            )}

            <Button className="min-h-11 w-full" onClick={() => void submit()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {mode === 'register' ? '注册并开始使用' : '登录'}
            </Button>

            {/* 已有账号快捷选择 */}
            {users.length > 0 && mode === 'login' && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">本机已有的账号：</p>
                <div className="flex flex-wrap gap-1.5">
                  {users.map((u) => (
                    <button
                      key={u}
                      onClick={() => {
                        setName(u)
                        setPass('')
                      }}
                      className="rounded-full border bg-muted/50 px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          免费使用 · 无需邮箱手机号 · 昵称只是本机标识
        </p>
      </div>
    </div>
  )
}
