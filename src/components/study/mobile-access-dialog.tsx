'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface MobileAccessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface QrState {
  dataUrl: string | null
  url: string
  failed: boolean
}

const IDLE: QrState = { dataUrl: null, url: '', failed: false }

/**
 * 手机访问弹窗：把当前预览地址生成二维码，手机扫码即可使用；
 * 并提供「添加到主屏幕」指引，让复习工具像 App 一样打开。
 */
export function MobileAccessDialog({ open, onOpenChange }: MobileAccessDialogProps) {
  const [state, setState] = useState<QrState>(IDLE)

  const generate = useCallback((current: string) => {
    QRCode.toDataURL(current, {
      width: 560,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#065f46', light: '#ffffff' },
    })
      .then((d) => setState({ dataUrl: d, url: current, failed: false }))
      .catch(() => setState({ dataUrl: null, url: current, failed: true }))
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // 当前页面的完整公网地址（预览面板分配的域名）
    const current = window.location.href
    QRCode.toDataURL(current, {
      width: 560,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#065f46', light: '#ffffff' },
    })
      .then((d) => {
        if (!cancelled) setState({ dataUrl: d, url: current, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ dataUrl: null, url: current, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(state.url)
      toast({ title: '地址已复制', description: '发送到手机后用浏览器打开即可' })
    } catch {
      toast({ title: '复制失败', description: '请手动选中地址复制', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="mobile-access-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-5 text-emerald-600 dark:text-emerald-400" />
            手机扫码访问
          </DialogTitle>
          <DialogDescription id="mobile-access-desc">
            用手机相机或微信「扫一扫」扫描下方二维码，即可在手机上使用复习工具。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* 二维码 */}
          <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-white">
            {state.dataUrl ? (
              <img
                src={state.dataUrl}
                alt={`当前页面访问二维码：${state.url}`}
                className="size-52 sm:size-56"
                aria-label="访问二维码"
              />
            ) : state.failed ? (
              <div className="flex size-52 items-center justify-center px-4 text-center text-sm text-stone-400 sm:size-56">
                二维码生成失败，请复制下方地址
              </div>
            ) : (
              <Skeleton className="size-52 rounded-xl sm:size-56" />
            )}
          </div>

          {/* 地址 + 复制 */}
          <div className="flex w-full items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-zinc-800 dark:text-zinc-300">
              {state.url || '…'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => void copyUrl()}
            >
              <Copy className="size-3.5" />
              复制
            </Button>
          </div>

          {/* 使用指引 */}
          <ol className="w-full space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <li>
              <strong>1.</strong> 手机扫码（或复制地址到手机浏览器打开）
            </li>
            <li>
              <strong>2.</strong> iPhone：Safari 分享 →「添加到主屏幕」；安卓：浏览器菜单 →「添加到桌面」
            </li>
            <li>
              <strong>3.</strong> 从主屏幕图标打开，即像 App 一样全屏复习；题目数据保存在云端，手机电脑互通
            </li>
          </ol>

          {state.dataUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-stone-500"
              onClick={() => {
                setState(IDLE)
                generate(window.location.href)
              }}
            >
              <RefreshCw className="size-3.5" />
              刷新二维码
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
