// Учёт расходов голосом: «запиши трату 2000 тенге на продукты», «сколько я потратил за неделю».
// Хранится только на этом устройстве.
const KEY = 'shef:expenses'
export type Expense = { amount: number; currency: string; category: string; note?: string; at: number }

function load(): Expense[] {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}
function save(l: Expense[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l.slice(-3000)))
  } catch {
    /* пусто */
  }
}

const CATS: [RegExp, string][] = [
  [/продукт|магазин|еда|супермаркет|овощ|мясо|молок|хлеб/, 'продукты'],
  [/кафе|ресторан|кофе|обед|ужин|доставк|фастфуд|бургер|пицц/, 'кафе и доставка'],
  [/такси|бензин|топливо|автобус|метро|проезд|парковк|машин|заправк/, 'транспорт'],
  [/одежд|обув|кроссовк|куртк/, 'одежда'],
  [/аптек|лекарств|врач|клиник|анализ/, 'здоровье'],
  [/коммунал|свет|газ|вода|квартир|аренд|интернет|связь|телефон/, 'дом и связь'],
  [/кино|игр|подписк|развлеч|концерт/, 'развлечения'],
  [/подар/, 'подарки'],
]
export function guessCategory(s: string) {
  const t = s.toLowerCase()
  return CATS.find(([re]) => re.test(t))?.[1] || (t.trim() || 'другое')
}

export function addExpense(amount: number, category: string, currency = 'KZT', note = '') {
  if (!(amount > 0)) return { ok: false, error: 'Какая сумма?' }
  const e: Expense = { amount: Math.round(amount * 100) / 100, currency: currency.toUpperCase() || 'KZT', category: guessCategory(category || note), note: note || undefined, at: Date.now() }
  save([...load(), e])
  const today = report('today')
  return { ok: true, saved: e, today_total: today.total }
}

function since(period: string): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  else if (period === 'month') d.setDate(1)
  else if (period === 'year') d.setMonth(0, 1)
  else if (period === 'all') return 0
  return d.getTime()
}

export function report(period = 'month') {
  const from = since(period)
  const l = load().filter((e) => e.at >= from)
  const byCur: Record<string, number> = {}
  const byCat: Record<string, number> = {}
  for (const e of l) {
    byCur[e.currency] = (byCur[e.currency] || 0) + e.amount
    if (e.currency === 'KZT' || Object.keys(byCur).length === 1) byCat[e.category] = (byCat[e.category] || 0) + e.amount
  }
  const main = Object.entries(byCur).sort((a, b) => b[1] - a[1])[0]
  return {
    period: { today: 'сегодня', week: 'эта неделя', month: 'этот месяц', year: 'этот год', all: 'всё время' }[period] || period,
    count: l.length,
    total: main ? Math.round(main[1]) : 0,
    currency: main?.[0] || 'KZT',
    by_currency: byCur,
    by_category: Object.fromEntries(Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
    last: l.slice(-5).reverse().map((e) => ({ amount: e.amount, currency: e.currency, category: e.category, note: e.note, when: new Date(e.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })),
  }
}

/** Удалить последнюю запись («отмени последнюю трату»). */
export function undoExpense() {
  const l = load()
  const e = l.pop()
  save(l)
  return e ? { ok: true, removed: e } : { ok: false, note: 'Трат ещё нет.' }
}

export function clearExpenses() {
  save([])
}
