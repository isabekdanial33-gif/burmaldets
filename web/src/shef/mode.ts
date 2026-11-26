// Режимы Гудвина. По умолчанию — обычный ассистент (как Алиса): про кухню не думает.
// «Гудвин, режим повара» — включает кухню: каталог рецептов ГрандШеф, готовка по шагам, холодильник.
// «Выйди из режима повара» / «обычный режим» — обратно.
import { setSession } from './session'

export type Mode = 'general' | 'cook'
const KEY = 'shef:mode'
const subs = new Set<(m: Mode) => void>()

export function getMode(): Mode {
  try {
    return localStorage.getItem(KEY) === 'cook' ? 'cook' : 'general'
  } catch {
    return 'general'
  }
}

export function setMode(m: Mode) {
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* без хранилища режим живёт до перезапуска */
  }
  if (m === 'general') setSession({ recipe: null, step: -1 })
  subs.forEach((f) => f(m))
}

export function onMode(f: (m: Mode) => void) {
  subs.add(f)
  return () => void subs.delete(f)
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:эй |ок |окей )?(?:гудвин\S*|гуд вин|шеф|chef)\s+/, '')
    .replace(/\s+пожалуйста$/, '')

const COOK = '(повара|поваров|повар|кухни|кухня|шефа|шеф повара|шеф-повара|готовки|кулинара|кулинарии|рецептов)'
const ON = new RegExp(`^(?:(?:включи|включить|активируй|перейди в|переключись в|переключи в|давай|запусти|зайди в|вруби)\\s+)?(?:режим\\s+)+${COOK}(?:\\s+режим)?$`)
const OFF = new RegExp(
  `^(?:(?:выйди|выйти|выход|выключи|выключить|отключи|закрой|заверши|хватит|убери|отмени|сбрось)\\s+(?:из\\s+)?(?:режим\\S*\\s+)+${COOK}|(?:обычный|нормальный|стандартный|общий)\\s+режим|режим\\s+(?:обычный|ассистента|алисы|по умолчанию)|(?:вернись|верни)\\s+(?:в\\s+)?(?:обычный|нормальный)(?:\\s+режим)?|хватит готовить)$`,
)

/** Команда смены режима? Возвращает новый режим или null. */
export function modeCommand(text: string): Mode | null {
  const s = clean(text)
  if (!s || s.split(' ').length > 7) return null
  if (OFF.test(s)) return 'general'
  if (ON.test(s)) return 'cook'
  return null
}
