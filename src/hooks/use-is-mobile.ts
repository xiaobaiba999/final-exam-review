'use client'

import { useSyncExternalStore } from 'react'

const MOBILE_UA_RE =
  /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Mobile|HarmonyOS/i

/** 客户端快照：手机 UA 或窄视口（< 768px）视为移动端 */
function getSnapshot(): boolean {
  if (MOBILE_UA_RE.test(navigator.userAgent)) return true
  return window.matchMedia('(max-width: 767px)').matches
}

/** 服务端快照：默认按桌面端渲染，水合后再按真实设备切换（无 hydration 告警） */
function getServerSnapshot(): boolean {
  return false
}

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia('(max-width: 767px)')
  mq.addEventListener('change', onChange)
  window.addEventListener('orientationchange', onChange)
  return () => {
    mq.removeEventListener('change', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

/**
 * 是否移动端环境（独立移动端 UI 的开关）：
 * - 手机 UA 直接判定为移动端
 * - 视口宽度 < 768px 同样进入移动端（便于桌面窗口拖窄预览）
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
