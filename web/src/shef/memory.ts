// Долгая память Бурмалдеца: что пользователь рассказал о себе. Хранится только на этом устройстве.
type Mem = { facts: string[]; city?: string; name?: string }
const KEY = 'shef:memory'
const MAX = 60

function load(): Mem {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { facts: Array.isArray(m.facts) ? m.facts.filter((x: unknown) => typeof x === 'string') : [], city: m.city, name: m.name }
  } catch {
    return { facts: [] }
  }
}
function save(m: Mem) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* нет хранилища — забудется после перезапуска */
  }
}

const low = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
const words = (s: string) => low(s).match(/[а-яa-z0-9]{3,}/g) || []

export const getCity = () => load().city
export const getName = () => load().name

/** Строки для системной подсказки. */
export function memoryFacts(): string[] {
  const m = load()
  return [m.name && `Зовут: ${m.name}`, m.city && `Город: ${m.city}`, ...m.facts].filter(Boolean) as string[]
}

export function remember(fact: string, extra: { city?: string; name?: string } = {}) {
  const m = load()
  if (extra.city) m.city = extra.city.trim()
  if (extra.name) m.name = extra.name.trim()
  const f = fact.trim().replace(/\s+/g, ' ')
  if (f) {
    // похожий факт заменяем новым: «любимый цвет синий» → «любимый цвет зелёный»
    const w = new Set(words(f))
    const i = m.facts.findIndex((x) => {
      const xs = words(x)
      const same = xs.filter((t) => w.has(t)).length
      return xs.length && same / Math.max(xs.length, w.size) >= 0.6
    })
    if (i >= 0) m.facts.splice(i, 1)
    m.facts.push(f)
    while (m.facts.length > MAX) m.facts.shift()
  }
  save(m)
  return memoryFacts()
}

/** Забыть всё, где встречаются эти слова. «всё» — очистить память. */
export function forget(what: string): string[] {
  const m = load()
  const q = low(what).trim()
  if (/^(все|всё|всю память|все факты|обо мне все)$/.test(q)) {
    save({ facts: [] })
    return ['всё']
  }
  const ws = words(q)
  const gone: string[] = []
  const hit = (s: string) => ws.some((w) => low(s).includes(w.slice(0, Math.max(3, w.length - 2))))
  m.facts = m.facts.filter((f) => (hit(f) ? (gone.push(f), false) : true))
  if (m.city && (/город/.test(q) || hit(m.city))) {
    gone.push('город ' + m.city)
    m.city = undefined
  }
  if (m.name && (/имя|зовут/.test(q) || hit(m.name))) {
    gone.push('имя ' + m.name)
    m.name = undefined
  }
  save(m)
  return gone
}

/** Удалить ровно эту строку из memoryFacts() (для кнопки ✕ в настройках). */
export function forgetLine(line: string) {
  const m = load()
  if (line.startsWith('Зовут: ')) m.name = undefined
  else if (line.startsWith('Город: ')) m.city = undefined
  else m.facts = m.facts.filter((f) => f !== line)
  save(m)
}
