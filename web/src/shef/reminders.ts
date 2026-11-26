// Напоминания и таймер сна. На телефоне — разовый сценарий в фоне (AlarmManager): сработает, даже если Гудвин закрыт,
// и после срабатывания удалится сам. На компьютере — пока открыта вкладка.
import { isAndroid } from './bridge'
import { addMacro, forgetCache, listMacros, type Macro } from './macros'
import { nativeCall } from './bridge'
import { say } from './speech'

type Obj = Record<string, unknown>
type R = Macro & { reminder?: boolean; trigger: Macro['trigger'] & { at?: number } }

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (ms: number) => {
  const d = new Date(ms)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86400000)
  const day = d.toDateString() === today.toDateString() ? 'сегодня' : d.toDateString() === tomorrow.toDateString() ? 'завтра' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return `${day} в ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function when(at: string, inMin: number): number | null {
  if (inMin > 0) return Date.now() + Math.round(inMin * 60000)
  if (!at) return null
  // «2026-11-26T09:00» без пояса — местное время (так и задумано)
  const t = new Date(at.replace(' ', 'T')).getTime()
  return isNaN(t) ? null : t
}

// --- компьютер: в памяти вкладки + localStorage, чтобы пережить перезагрузку страницы ---
const PC_KEY = 'shef:reminders'
type PcR = { id: string; text: string; at: number; kind: 'remind' | 'sleep' }
const timers = new Map<string, number>()
const pcLoad = (): PcR[] => {
  try {
    return JSON.parse(localStorage.getItem(PC_KEY) || '[]')
  } catch {
    return []
  }
}
const pcSave = (l: PcR[]) => {
  try {
    localStorage.setItem(PC_KEY, JSON.stringify(l))
  } catch {
    /* пусто */
  }
}
function pcArm(r: PcR) {
  clearTimeout(timers.get(r.id))
  const fire = () => {
    pcSave(pcLoad().filter((x) => x.id !== r.id))
    timers.delete(r.id)
    if (r.kind !== 'remind') return
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Напоминание', { body: r.text })
    } catch {
      /* нет уведомлений */
    }
    say('Напоминаю: ' + r.text).catch(() => {})
  }
  const left = r.at - Date.now()
  if (left <= 0) fire()
  else timers.set(r.id, window.setTimeout(fire, Math.min(left, 2 ** 31 - 1)))
}
if (!isAndroid && typeof window !== 'undefined') pcLoad().forEach(pcArm)

export async function setReminder(text: string, at: string, inMin: number): Promise<Obj> {
  const t = text.trim()
  if (!t) return { ok: false, error: 'О чём напомнить?' }
  const ms = when(at, inMin)
  if (!ms) return { ok: false, error: 'Не понял, когда напомнить. Назовите время или через сколько минут.' }
  if (ms < Date.now() + 20000) return { ok: false, error: 'Это время уже прошло — назовите время в будущем.' }
  if (isAndroid) {
    const d = new Date(ms)
    const m: Omit<R, 'id'> = {
      name: 'Напоминание: ' + t.slice(0, 40),
      reminder: true,
      trigger: { type: 'time', at: ms, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` } as R['trigger'],
      actions: [
        { type: 'notify', title: 'Напоминание', text: t },
        { type: 'vibrate', seconds: 1 },
        { type: 'speak', text: 'Напоминаю: ' + t },
      ] as Macro['actions'],
    }
    const r = await addMacro(m as Omit<Macro, 'id'>)
    const st = await listMacros(true).catch(() => null)
    return {
      ok: r.ok,
      when: fmt(ms),
      text: t,
      note: st && !st.exact ? 'Точные будильники для Гудвина выключены — напоминание может прийти с опозданием до минуты-двух. Включить: grant_permission exact.' : undefined,
    }
  }
  const r: PcR = { id: 'r' + Date.now().toString(36), text: t, at: ms, kind: 'remind' }
  pcSave([...pcLoad(), r])
  pcArm(r)
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
  } catch {
    /* пусто */
  }
  return { ok: true, when: fmt(ms), text: t, note: 'На компьютере напоминание сработает, только если вкладка Гудвина будет открыта.' }
}

async function androidReminders(): Promise<R[]> {
  const r = await listMacros(true)
  return (r.macros as R[]).filter((m) => m.reminder && m.enabled !== false)
}

export async function listReminders(): Promise<Obj> {
  if (isAndroid) {
    const l = (await androidReminders()).filter((m) => (m.trigger.at || 0) > Date.now()).sort((a, b) => (a.trigger.at || 0) - (b.trigger.at || 0))
    return { count: l.length, items: l.map((m) => ({ text: m.name.replace(/^Напоминание: /, ''), when: fmt(m.trigger.at || 0) })) }
  }
  const l = pcLoad().filter((x) => x.at > Date.now()).sort((a, b) => a.at - b.at)
  return { count: l.length, items: l.map((x) => ({ text: x.kind === 'sleep' ? 'таймер сна' : x.text, when: fmt(x.at) })) }
}

export async function cancelReminder(what: string): Promise<Obj> {
  const q = what.toLowerCase().replace(/ё/g, 'е').trim()
  const all = /^(все|всё|все напоминания)$/.test(q)
  const ws = q.match(/[а-яa-z0-9]{3,}/g) || []
  const hit = (s: string) => all || ws.some((w) => s.toLowerCase().replace(/ё/g, 'е').includes(w.slice(0, Math.max(3, w.length - 2))))
  if (isAndroid) {
    const l = (await androidReminders()).filter((m) => hit(m.name))
    for (const m of l) await nativeCall('macroDelete', { id: m.id }, 5000).catch(() => {})
    forgetCache()
    return l.length ? { ok: true, cancelled: l.map((m) => m.name.replace(/^Напоминание: /, '')) } : { ok: false, note: 'Такого напоминания нет.' }
  }
  const l = pcLoad()
  const gone = l.filter((x) => hit(x.text))
  gone.forEach((x) => clearTimeout(timers.get(x.id)))
  pcSave(l.filter((x) => !gone.includes(x)))
  return gone.length ? { ok: true, cancelled: gone.map((x) => x.text) } : { ok: false, note: 'Такого напоминания нет.' }
}

export async function sleepTimer(minutes: number): Promise<Obj> {
  if (!(minutes > 0)) return { ok: false, error: 'Через сколько минут выключить музыку?' }
  if (!isAndroid) return { ok: false, note: 'Таймер сна работает только в приложении Гудвин на телефоне.' }
  const ms = Date.now() + Math.round(minutes * 60000)
  const d = new Date(ms)
  const r = await addMacro({
    name: 'Таймер сна',
    reminder: true,
    trigger: { type: 'time', at: ms, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` },
    actions: [{ type: 'media', action: 'pause' }],
  } as unknown as Omit<Macro, 'id'>)
  return { ok: r.ok, when: fmt(ms) }
}
