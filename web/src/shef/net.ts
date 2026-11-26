// Сетевые запросы к ИИ-провайдерам. На телефоне и на компьютере — через нативную часть (там нет ограничений CORS
// и ключ не уходит никуда, кроме выбранного провайдера). В обычном браузере — напрямую.
import { isAndroid, nativeCall } from './bridge'

export type Resp = { status: number; body: string; type?: string; b64?: string }
type Opts = { method?: string; headers?: Record<string, string>; body?: string; binary?: boolean }

type Desk = { fetch(url: string, o: Opts, timeoutMs: number): Promise<Resp> }
export const desk = (window as unknown as { bmDesk?: Desk & Record<string, unknown> }).bmDesk
export const isDesktop = !!desk

export async function http(url: string, o: Opts = {}, timeoutMs = 20000): Promise<Resp> {
  if (isAndroid) return nativeCall<Resp>('fetch', { url, method: o.method || 'GET', headers: o.headers || {}, body: o.body || '', binary: !!o.binary, timeout: timeoutMs }, timeoutMs + 3000)
  if (desk) return desk.fetch(url, o, timeoutMs)
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  // x-body-b64: тело передано в base64 (двоичные данные через мост) — в браузере раскодируем сами
  const headers = { ...(o.headers || {}) }
  let body: BodyInit | undefined = o.body || undefined
  if (headers['x-body-b64']) {
    delete headers['x-body-b64']
    body = Uint8Array.from(atob(o.body || ''), (c) => c.charCodeAt(0))
  }
  try {
    const r = await fetch(url, { method: o.method || 'GET', headers, body, signal: ctl.signal })
    if (o.binary) {
      const buf = new Uint8Array(await r.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { status: r.status, body: '', type: r.headers.get('content-type') || '', b64: btoa(s) }
    }
    return { status: r.status, body: await r.text(), type: r.headers.get('content-type') || '' }
  } finally {
    clearTimeout(t)
  }
}
