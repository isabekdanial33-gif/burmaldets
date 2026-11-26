// Мост к нативной части Android-приложения «Бурмалдец». На компьютере/в браузере его нет — тогда всё делает веб.
type Native = { call(id: string, method: string, args: string): void; platform(): string }
type W = Window & {
  ShefNative?: Native
  __shefCb?: (id: string, json: string) => void
  __shefEvent?: (name: string, json: string) => void
}
const w = window as W

export const native: Native | undefined = w.ShefNative
export const isAndroid = !!native
export const platform = native ? 'android' : /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile-web' : 'pc'

const pending = new Map<string, (v: unknown) => void>()
w.__shefCb = (id, json) => {
  const f = pending.get(id)
  pending.delete(id)
  try {
    f?.(JSON.parse(json))
  } catch {
    f?.(null)
  }
}

const listeners = new Map<string, Set<(d: unknown) => void>>()
w.__shefEvent = (name, json) => {
  let d: unknown = null
  try {
    d = JSON.parse(json)
  } catch {
    /* пусто */
  }
  listeners.get(name)?.forEach((f) => f(d))
}
/** События от телефона: wake (услышал «Бурмалдец»), stt-partial, tts-level, back. */
export function onNative(name: string, f: (d: unknown) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name)!.add(f)
  return () => listeners.get(name)!.delete(f)
}

let seq = 0
export function nativeCall<T = Record<string, unknown>>(method: string, args: Record<string, unknown> = {}, timeoutMs = 60000): Promise<T> {
  if (!native) return Promise.reject(new Error('no_native'))
  const id = 'c' + ++seq
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id)
      reject(new Error('timeout'))
    }, timeoutMs)
    pending.set(id, (v) => {
      clearTimeout(t)
      resolve(v as T)
    })
    native.call(id, method, JSON.stringify(args))
  })
}
