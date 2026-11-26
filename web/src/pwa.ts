// PWA: регистрация service worker (только в production-сборке) и «Установить на главный экран».
import { useSyncExternalStore } from 'react'

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BIPEvent | null = null
let installed = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function initPwa() {
  // в приложении «Шеф» сайт и так лежит внутри APK — service worker не нужен
  if (import.meta.env.PROD && 'serviceWorker' in navigator && !('ShefNative' in window)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        /* без SW сайт работает как обычно */
      })
    })
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // покажем свою кнопку, а не системную плашку
    deferred = e as BIPEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

export type InstallState = { can: boolean; ios: boolean; installed: boolean }
let snap: InstallState = { can: false, ios: false, installed: false }
function snapshot(): InstallState {
  const next = { can: !!deferred, ios: !deferred && isIos() && !standalone(), installed: installed || standalone() }
  if (next.can !== snap.can || next.ios !== snap.ios || next.installed !== snap.installed) snap = next
  return snap
}

/** can — браузер разрешил установку (Chrome/Edge/Android); ios — показать подсказку «Поделиться → На экран „Домой“». */
export function useInstall() {
  return useSyncExternalStore((cb) => {
    subs.add(cb)
    return () => subs.delete(cb)
  }, snapshot)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  emit()
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome === 'accepted'
}
