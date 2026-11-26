import { useEffect, useState, useSyncExternalStore } from 'react'

export type Timer = { id: string; label: string; total: number; endsAt: number; paused?: number; done?: boolean }

let timers: Timer[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function startTimer(label: string, seconds: number) {
  timers = [...timers, { id: Math.random().toString(36).slice(2), label, total: seconds, endsAt: Date.now() + seconds * 1000 }]
  emit()
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}
function update(id: string, patch: Partial<Timer>) {
  timers = timers.map((t) => (t.id === id ? { ...t, ...patch } : t))
  emit()
}
function remove(id: string) {
  timers = timers.filter((t) => t.id !== id)
  emit()
}

function beep() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.35, 0.7].forEach((d) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime + d)
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + d)
      o.stop(ctx.currentTime + d + 0.32)
    })
  } catch {
    /* нет звука — не страшно */
  }
  navigator.vibrate?.([300, 150, 300])
}

export function useTimers() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => timers,
  )
}

export const fmt = (s: number) => {
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0')
}

/** Ищет в тексте шага «12 минут», «1,5 часа», «3–4 мин» — для кнопок таймера. */
export function findDurations(text: string): { label: string; seconds: number }[] {
  const out: { label: string; seconds: number }[] = []
  const re = /(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*(час(?:а|ов)?|ч\.|минут[ыу]?|мин\.?|секунд[ыу]?|сек\.?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const v = parseFloat((m[2] || m[1]).replace(',', '.'))
    const unit = m[3].toLowerCase()
    const mult = unit.startsWith('ч') ? 3600 : unit.startsWith('с') ? 1 : 60
    const seconds = Math.round(v * mult)
    if (seconds > 0 && seconds <= 48 * 3600) out.push({ label: m[0].trim(), seconds })
  }
  return out
}

export function TimersDock() {
  const list = useTimers()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!list.length) return
    const i = setInterval(() => {
      tick((x) => x + 1)
      for (const t of timers) {
        if (!t.done && !t.paused && Date.now() >= t.endsAt) {
          update(t.id, { done: true })
          beep()
          if ('Notification' in window && Notification.permission === 'granted') new Notification('⏰ ' + t.label, { body: 'Таймер завершён' })
        }
      }
    }, 250)
    return () => clearInterval(i)
  }, [list.length])
  if (!list.length) return null
  return (
    <div className="timers-dock">
      {list.map((t) => {
        const left = t.paused ?? (t.endsAt - Date.now()) / 1000
        const pct = 1 - Math.max(0, left) / t.total
        return (
          <div key={t.id} className={'timer' + (t.done ? ' done' : '')}>
            <div className="timer-bar" style={{ width: `${Math.min(100, pct * 100)}%` }} />
            <div className="timer-body">
              <div className="timer-label">{t.label}</div>
              <div className="timer-time">{t.done ? 'Готово!' : fmt(left)}</div>
            </div>
            <div className="timer-actions">
              {!t.done && (
                <button
                  className="icon-btn"
                  title={t.paused ? 'Продолжить' : 'Пауза'}
                  onClick={() => (t.paused !== undefined ? update(t.id, { paused: undefined, endsAt: Date.now() + t.paused * 1000 }) : update(t.id, { paused: (t.endsAt - Date.now()) / 1000 }))}
                >
                  {t.paused !== undefined ? '▶' : '❚❚'}
                </button>
              )}
              {!t.done && (
                <button className="icon-btn" title="+1 минута" onClick={() => (t.paused !== undefined ? update(t.id, { paused: t.paused + 60, total: t.total + 60 }) : update(t.id, { endsAt: t.endsAt + 60000, total: t.total + 60 }))}>
                  +1
                </button>
              )}
              <button className="icon-btn" title="Убрать" onClick={() => remove(t.id)}>
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
