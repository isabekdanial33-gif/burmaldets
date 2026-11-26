// Сценарии «когда X → сделай Y» (как MacroDroid). Создаются голосом: Гудвин описывает сценарий и создаёт его только после «да».
// Работают на телефоне сами, даже когда Гудвин закрыт.
import { isAndroid, nativeCall } from './bridge'
import { getContacts, matchContacts } from './contacts'

export type Trigger = {
  type: string
  time?: string
  days?: number[]
  date?: string
  minutes?: number
  level?: number
  app?: string
  text?: string
  phrase?: string
  ssid?: string
  device?: string
}
export type Action = { type: string; [k: string]: unknown }
export type Macro = { id: string; name: string; enabled?: boolean; trigger: Trigger; actions: Action[] }

export const TRIGGERS = [
  'time', 'interval', 'voice', 'charger_on', 'charger_off', 'battery_low', 'battery_high', 'headphones_on', 'headphones_off',
  'screen_on', 'screen_off', 'unlock', 'wifi_on', 'wifi_off', 'bluetooth_on', 'bluetooth_off', 'app_opened', 'notification', 'boot',
]
export const ACTIONS = [
  'speak', 'notify', 'vibrate', 'wait', 'torch', 'volume', 'ringer', 'dnd', 'brightness', 'open_app', 'open_url', 'play_music', 'media',
  'timer', 'alarm', 'navigate', 'open_settings', 'phone_action', 'tap_text', 'call', 'send_message', 'shef',
]

const DAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
function daysText(d?: number[]) {
  if (!d?.length || d.length === 7) return 'каждый день'
  const s = [...d].sort().join()
  if (s === '1,2,3,4,5') return 'по будням'
  if (s === '6,7') return 'по выходным'
  return 'по ' + d.map((x) => DAYS[x]).join(', ')
}

export function triggerText(t: Trigger): string {
  switch (t.type) {
    case 'time':
      return t.date ? `${t.date} в ${t.time}` : `${daysText(t.days)} в ${t.time}`
    case 'interval':
      return `каждые ${t.minutes} мин`
    case 'voice':
      return `когда скажете «${t.phrase}»`
    case 'charger_on':
      return 'когда подключаете зарядку'
    case 'charger_off':
      return 'когда отключаете зарядку'
    case 'battery_low':
      return `когда заряд опустится до ${t.level ?? 20}%`
    case 'battery_high':
      return `когда заряд дойдёт до ${t.level ?? 90}%`
    case 'headphones_on':
      return 'когда подключаете наушники'
    case 'headphones_off':
      return 'когда отключаете наушники'
    case 'screen_on':
      return 'когда включается экран'
    case 'screen_off':
      return 'когда гаснет экран'
    case 'unlock':
      return 'когда разблокируете телефон'
    case 'wifi_on':
      return t.ssid ? `при подключении к Wi-Fi «${t.ssid}»` : 'при подключении к Wi-Fi'
    case 'wifi_off':
      return 'когда пропадает Wi-Fi'
    case 'bluetooth_on':
      return t.device ? `когда подключается «${t.device}»` : 'когда подключается Bluetooth-устройство'
    case 'bluetooth_off':
      return t.device ? `когда отключается «${t.device}»` : 'когда отключается Bluetooth-устройство'
    case 'app_opened':
      return `когда открываете ${t.app}`
    case 'notification':
      return `когда приходит уведомление${t.app ? ' от ' + t.app : ''}${t.text ? ` со словами «${t.text}»` : ''}`
    case 'boot':
      return 'после включения телефона'
    default:
      return t.type
  }
}

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))
/** {from} {text} {app} {level} → понятные слова, чтобы вопрос-подтверждение звучал по-человечески. */
const human = (t: string) =>
  t.replace(/\{from\}/g, 'отправитель').replace(/\{text\}/g, 'текст сообщения').replace(/\{app\}/g, 'приложение').replace(/\{level\}/g, 'заряд').replace(/\{device\}/g, 'устройство').replace(/\{ssid\}/g, 'сеть')

export function actionText(a: Action): string {
  switch (a.type) {
    case 'speak':
      return `сказать «${human(s(a.text))}»`
    case 'notify':
      return `уведомление «${human(s(a.text))}»`
    case 'vibrate':
      return 'вибрация'
    case 'wait':
      return `подождать ${s(a.seconds)} с`
    case 'torch':
      return a.on === false ? 'выключить фонарик' : 'включить фонарик'
    case 'volume':
      return `громкость ${s(a.percent)}%`
    case 'ringer':
      return a.mode === 'silent' ? 'режим без звука' : a.mode === 'vibrate' ? 'режим вибрации' : 'обычный звук'
    case 'dnd':
      return a.on === false ? 'выключить «Не беспокоить»' : 'включить «Не беспокоить»'
    case 'brightness':
      return `яркость ${s(a.percent)}%`
    case 'open_app':
      return `открыть ${s(a.app)}`
    case 'open_url':
      return `открыть ${s(a.url)}`
    case 'play_music':
      return `включить музыку «${s(a.query)}»`
    case 'media':
      return a.action === 'pause' ? 'пауза' : a.action === 'next' ? 'следующий трек' : 'продолжить музыку'
    case 'timer':
      return `таймер на ${Math.round(Number(a.seconds) / 60) || s(a.seconds) + ' с'} мин`
    case 'alarm':
      return `будильник на ${s(a.time)}`
    case 'navigate':
      return `маршрут до «${s(a.place)}»`
    case 'open_settings':
      return `открыть настройки ${s(a.what)}`
    case 'phone_action':
      return `кнопка «${s(a.action)}»`
    case 'tap_text':
      return `нажать «${s(a.text)}»`
    case 'call':
      return `позвонить «${s(a.name) || s(a.number)}»`
    case 'send_message':
      return `написать «${s(a.name) || s(a.number)}»${a.app && a.app !== 'sms' ? ' в ' + s(a.app) : ' SMS'}: «${s(a.text)}»`
    case 'shef':
      return `попросить Гудвина: «${s(a.text)}»`
    default:
      return a.type
  }
}

export const macroText = (m: Pick<Macro, 'trigger' | 'actions'>) => `${triggerText(m.trigger)} — ${m.actions.map(actionText).join(', затем ')}`

/** Имена контактов в действиях «позвонить/написать» превращаем в номера сразу при создании. */
export async function resolveContacts(actions: Action[]): Promise<{ actions: Action[]; error?: string }> {
  const out: Action[] = []
  for (const a of actions) {
    if ((a.type === 'call' || a.type === 'send_message') && !a.number && a.to) {
      const to = s(a.to)
      if (/^[+\d][\d\s()-]{4,}$/.test(to)) {
        out.push({ ...a, number: to })
        continue
      }
      const { list, error } = await getContacts()
      if (error) return { actions, error: 'нет доступа к контактам' }
      const m = matchContacts(to, list)
      if (!m.length) return { actions, error: `контакт «${to}» не найден` }
      if (m.length > 1 && m[1].score > m[0].score - 12 && m[1].name !== m[0].name) return { actions, error: `несколько похожих контактов: ${m.slice(0, 4).map((c) => c.name).join(', ')} — уточните` }
      out.push({ ...a, number: m[0].number, name: m[0].name })
    } else out.push(a)
  }
  return { actions: out }
}

type ListResp = { macros: Macro[]; exact: boolean; writeSettings: boolean; dnd: boolean; screen: boolean }
let cache: { at: number; r: ListResp } | null = null

export async function listMacros(fresh = false): Promise<ListResp> {
  if (!isAndroid) return { macros: [], exact: false, writeSettings: false, dnd: false, screen: false }
  if (!fresh && cache && Date.now() - cache.at < 15000) return cache.r
  const r = await nativeCall<ListResp>('macroList', {}, 8000)
  cache = { at: Date.now(), r }
  return r
}
export const forgetCache = () => (cache = null)

export async function addMacro(m: Omit<Macro, 'id'>) {
  cache = null
  return nativeCall<{ ok: boolean; id: string }>('macroAdd', { macro: m }, 8000)
}

/** Голосовой триггер: «Гудвин, режим кухни» запускает сценарий с этой фразой. */
export async function voiceMacro(text: string): Promise<Macro | null> {
  if (!isAndroid) return null
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/^\s*(?:гудвин\S*|гуд вин|шеф)\s+/, '').replace(/\s+/g, ' ').trim()
  const t = norm(text)
  const r = await listMacros().catch(() => null)
  const m = r?.macros.find((x) => x.enabled !== false && x.trigger.type === 'voice' && x.trigger.phrase && norm(x.trigger.phrase) === t)
  if (!m) return null
  await nativeCall('macroRun', { id: m.id }, 8000).catch(() => {})
  return m
}
