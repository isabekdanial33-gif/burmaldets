// «Шеф-ассистент»: локальный алгоритм составления меню на неделю.
// Работает в браузере, без серверного ИИ: подбирает блюда под цель по калориям и БЖУ дня,
// не повторяет блюда внутри недели и избегает блюд из прошлых генераций,
// чередует основной продукт (курица/мясо/рыба/овощи), учитывает время на готовку в будни.
import type { IndexItem } from './data'

export type Goal = 'lose' | 'keep' | 'gain'
export type Diet = 'any' | 'pp' | 'veg' | 'nopork'
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'dessert'
export type Settings = {
  goal: Goal
  kcal: number
  people: number
  diet: Diet
  exclude: string
  weekdayMax: number
  desserts: boolean
}
export type Meal = { slot: Slot; id: string; why: string[] }
export type Day = { meals: Meal[] }
export type WeekPlan = { createdAt: string; settings: Settings; days: Day[]; seed: number }

export const SLOT_NAMES: Record<Slot, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', dessert: 'Десерт' }
export const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const SHARE: Record<Slot, number> = { breakfast: 0.25, lunch: 0.37, dinner: 0.28, dessert: 0.1 }

const BREAKFAST_RE = /сырник|омлет|яичниц|каш|овсян|гранол|блин|оладь|панкейк|тост|бутерброд|завтрак|скрэмбл|шакшук|фриттат|кесадиль|творожн|запеканк[аи] творож|яйц[оа] в|маффин|сэндвич|круассан|вафл|ленивые/i
const PORK_RE = /свин|бекон|ветчин|колбас|сосиск|сало|грудинк/i

export function mainProtein(i: IndexItem): string {
  // «куриное яйцо» — это яйцо, а не птица
  const s = [i.t, ...i.ing].map((x) => x.toLowerCase().replace(/курин\S*\s+яй\S*|яй\S*\s+курин\S*/g, 'яйцо')).join(' | ')
  if (/лосос|рыб|треск|форел|минтай|скумбр|креветк|кальмар|тунец|судак|дорадо|сибас|хек|тилапи/.test(s)) return 'рыба'
  if (/куриц|курин|цыпл|индейк|утк|грудк|бедр|крыл|голен/.test(s)) return 'птица'
  if (/говяд|свин|баран|стейк|фарш|ребр|рёбр|бекон|телят|шашлык/.test(s)) return 'мясо'
  if (/творог|сыр|яйц/.test(s)) return 'молочное'
  return 'овощи'
}

function pools(items: IndexItem[], s: Settings) {
  const ex = s.exclude
    .toLowerCase()
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2)
  const ok = items.filter((i) => {
    if (!i.kc || i.kc < 60) return false
    const hay = (i.t + ' ' + i.ing.join(' ')).toLowerCase()
    if (ex.some((e) => hay.includes(e.slice(0, Math.max(4, e.length - 2))))) return false
    if (s.diet === 'veg' && !i.g.includes('Вегетарианское') && !i.g.includes('Постное')) return false
    if (s.diet === 'pp' && !(i.pl.includes('pp') || (i.kc && i.kc < 450 && (i.p ?? 0) >= 15))) return false
    if (s.diet === 'nopork' && PORK_RE.test(hay)) return false
    return true
  })
  // десерт — сладкое без рыбы, мяса и птицы («треска с карамелизованным луком» — не десерт)
  const SAVORY = /лосос|рыб|треск|форел|минтай|скумбр|креветк|кальмар|тунец|судак|фарш|говяд|свин|баран|стейк|бекон|ветчин|колбас|сосиск|грудк|бедр|крыл|голен|индейк|утк|цыпл|курица|куриное филе|репчат|чеснок|лук-порей|луком/
  const sweet = (i: IndexItem) =>
    !SAVORY.test((i.t + ' ' + i.ing.join(' ')).toLowerCase()) &&
    (i.c.includes('Десерты') || (i.c.includes('Выпечка') && /сахар|мед|мёд|шоколад|ягод|яблок|ванил|сгущ|какао/.test(i.ing.join(' '))))
  const main = (i: IndexItem) =>
    !sweet(i) && (i.c.some((c) => ['Мясо', 'Курица и птица', 'Рыба и морепродукты', 'Супы', 'Овощи и гарниры'].includes(c)) || (i.p ?? 0) >= 18)
  return {
    breakfast: ok.filter((i) => i.c.includes('Завтраки') || BREAKFAST_RE.test(i.t)),
    lunch: ok.filter(main),
    dinner: ok.filter((i) => main(i) && !i.c.includes('Супы')),
    dessert: ok.filter(sweet),
    byId: new Map(items.map((i) => [i.id, i])),
  }
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export function explain(i: IndexItem, slot: Slot, s: Settings): string[] {
  const why: string[] = []
  const prot = i.p ?? 0
  const pr = mainProtein(i)
  if (prot >= 30) why.push(`${prot} г белка на порцию — сытость надолго и поддержка мышц`)
  else if (prot >= 18) why.push(`${prot} г белка — хороший баланс для ${SLOT_NAMES[slot].toLowerCase()}а`)
  if (pr === 'рыба') why.push('Рыба — источник полезных жиров омега-3 и йода')
  if (pr === 'птица' && (i.f ?? 99) < 15) why.push('Птица с умеренным жиром — лёгкий источник белка')
  if (/брокколи|капуст|кабач|шпинат|морков|тыкв|перец|баклажан|фасол|спарж|овощ|томат|помидор/.test(i.ing.join(' '))) why.push('Овощи дают клетчатку и витамины')
  if (/овсян|гречк|булгур|киноа|нут|чечевиц|цельнозерн/.test(i.ing.join(' '))) why.push('Сложные углеводы — ровная энергия без скачков сахара')
  if (/творог|йогурт|кефир|сыр/.test(i.ing.join(' ')) && slot !== 'dinner') why.push('Молочные продукты — кальций и белок')
  if (i.m.some((m) => ['Аэрогриль', 'Гриль', 'Барбекю', 'Запекание'].includes(m)))
    why.push(`Режим «${i.m[0]}» в ГрандШефе — хрустящая корочка с минимумом масла`)
  if (i.m.includes('Су-вид')) why.push('Су-вид сохраняет сочность без лишнего жира')
  if (i.m.includes('Пар')) why.push('На пару сохраняется больше витаминов')
  if (s.goal === 'lose' && i.kc && i.kc <= 450 && slot !== 'dessert') why.push(`Всего ${i.kc} ккал — вписывается в дефицит`)
  if (s.goal === 'gain' && i.kc && i.kc >= 550) why.push(`${i.kc} ккал — помогает добрать калории для набора`)
  if (slot === 'dessert') why.push('Небольшая порция сладкого по плану — легче держать режим без срывов')
  if (i.min && i.min <= 25) why.push(`Готовится примерно за ${i.min} мин`)
  return why.slice(0, 4)
}

// ---------- цели по БЖУ ----------
/** Доли калорий из белков, жиров и углеводов для каждой цели. */
export const MACRO_SPLIT: Record<Goal, { p: number; f: number; c: number }> = {
  lose: { p: 0.3, f: 0.28, c: 0.42 },
  keep: { p: 0.25, f: 0.3, c: 0.45 },
  gain: { p: 0.25, f: 0.25, c: 0.5 },
}
export type Macros = { kc: number; p: number; f: number; c: number }
/** Суточные цели: ккал и граммы БЖУ (1 г белка/углеводов = 4 ккал, жиров = 9 ккал). */
export function macroTargets(s: Pick<Settings, 'kcal' | 'goal'>): Macros {
  const sp = MACRO_SPLIT[s.goal]
  return { kc: s.kcal, p: Math.round((s.kcal * sp.p) / 4), f: Math.round((s.kcal * sp.f) / 9), c: Math.round((s.kcal * sp.c) / 4) }
}

const mac = (i: IndexItem): Macros => ({ kc: i.kc || 0, p: i.p ?? 0, f: i.f ?? (i.kc || 0) * 0.045, c: i.cb ?? (i.kc || 0) * 0.1 })
const sq = (x: number) => x * x
const add = (a: Macros, b: Macros): Macros => ({ kc: a.kc + b.kc, p: a.p + b.p, f: a.f + b.f, c: a.c + b.c })
const ZERO: Macros = { kc: 0, p: 0, f: 0, c: 0 }

/**
 * Насколько день далёк от цели (0 — идеально). Асимметрично: перебор жиров и недобор белка
 * штрафуются сильнее, чем обратное, — именно они чаще всего «ломают» меню из реальных рецептов
 * (у половины рецептов больше 48% калорий — из жиров).
 */
export function dayLoss(t: Macros, tg: Macros) {
  const kc = (t.kc - tg.kc) / tg.kc
  const f = (t.f - tg.f) / tg.f
  const p = (t.p - tg.p) / tg.p
  const c = (t.c - tg.c) / tg.c
  return (
    sq(kc) * 900 +
    (Math.abs(kc) > 0.08 ? (Math.abs(kc) - 0.08) * 400 : 0) +
    (f > 0 ? sq(f) * 420 + (f > 0.15 ? (f - 0.15) * 160 : 0) : sq(f) * 60) +
    (p < 0 ? sq(p) * 300 : sq(Math.max(0, p - 0.35)) * 60) +
    sq(c) * 70
  )
}

type PrefCtx = { slot: Slot; weekday: boolean; s: Settings; history: Set<string>; dayProteins: string[]; prevProtein?: string; rnd: number; protein: string }
/** Предпочтение блюда без учёта КБЖУ: разнообразие, проверенность, время, история. */
function preference(i: IndexItem, ctx: PrefCtx) {
  let score = 0
  if (ctx.history.has(i.id)) score -= 25 // было в прошлых меню
  if (ctx.slot !== 'breakfast' && ctx.slot !== 'dessert') {
    if (ctx.dayProteins.includes(ctx.protein)) score -= 12 // не повторяем основной продукт за день
    if (ctx.prevProtein === ctx.protein) score -= 8 // и в тот же слот вчера
  }
  if (ctx.weekday && i.min && i.min > ctx.s.weekdayMax) score -= 20
  if (!ctx.weekday && i.c.includes('Мясо') && ctx.slot === 'dinner') score += 3 // выходные — время на мясо
  score += i.tr / 20 + (i.im ? 2 : 0) + Math.log10(i.vw + 10)
  score += ctx.rnd * 14 // разнообразие между генерациями
  return score
}

/**
 * Составляет меню. Для каждого дня: жадно по слотам с пересчётом остатка дня
 * (уже выбранные блюда + идеальная доля на пустые слоты), затем 2 прохода улучшения —
 * каждое блюдо дня пробуем заменить на лучшее по «КБЖУ дня + предпочтения».
 */
export function generate(items: IndexItem[], s: Settings, history: Set<string>, seed: number): WeekPlan {
  const P = pools(items, s)
  const rand = rng(seed)
  const used = new Set<string>()
  const slots: Slot[] = s.desserts ? ['breakfast', 'lunch', 'dinner', 'dessert'] : ['breakfast', 'lunch', 'dinner']
  const share = { ...SHARE }
  if (!s.desserts) {
    share.lunch += 0.05
    share.dinner += 0.05
  }
  const tg = macroTargets(s)
  const ideal = (slot: Slot): Macros => ({ kc: tg.kc * share[slot], p: tg.p * share[slot], f: tg.f * share[slot], c: tg.c * share[slot] })
  const protOf = new Map<string, string>()
  const prot = (i: IndexItem) => {
    let v = protOf.get(i.id)
    if (v === undefined) protOf.set(i.id, (v = mainProtein(i)))
    return v
  }
  const macOf = new Map<string, Macros>()
  const m = (i: IndexItem) => {
    let v = macOf.get(i.id)
    if (!v) macOf.set(i.id, (v = mac(i)))
    return v
  }
  const days: Day[] = []
  for (let d = 0; d < 7; d++) {
    const weekday = d < 5
    const picks: (IndexItem | null)[] = slots.map(() => null)
    // случайная добавка фиксируется на день, чтобы проходы улучшения не «скакали»
    const noise = new Map<string, number>()
    const rnd = (id: string) => {
      let v = noise.get(id)
      if (v === undefined) noise.set(id, (v = rand()))
      return v
    }
    const best = (k: number) => {
      const slot = slots[k]
      let base = ZERO
      const dayProteins: string[] = []
      picks.forEach((x, j) => {
        if (j === k) return
        base = add(base, x ? m(x) : ideal(slots[j]))
        if (x) dayProteins.push(prot(x))
      })
      const prevId = days[d - 1]?.meals.find((ml) => ml.slot === slot)?.id
      const prev = prevId ? P.byId.get(prevId) : undefined
      const prevProtein = prev ? prot(prev) : undefined
      const pool = P[slot].length ? P[slot] : P.lunch
      let bestI: IndexItem | null = null
      let bestScore = -Infinity
      for (const i of pool) {
        if (used.has(i.id)) continue
        const score = preference(i, { slot, weekday, s, history, dayProteins, prevProtein, rnd: rnd(i.id), protein: prot(i) }) - dayLoss(add(base, m(i)), tg)
        if (score > bestScore) {
          bestScore = score
          bestI = i
        }
      }
      return bestI
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < slots.length; k++) {
        const cur = picks[k]
        if (cur) used.delete(cur.id)
        const b = best(k) ?? cur
        picks[k] = b
        if (b) used.add(b.id)
      }
    }
    const meals: Meal[] = []
    picks.forEach((b, k) => b && meals.push({ slot: slots[k], id: b.id, why: explain(b, slots[k], s) }))
    days.push({ meals })
  }
  return { createdAt: new Date().toISOString(), settings: s, days, seed }
}

/** Замена одного блюда — без списания генерации. Замена подбирается так, чтобы КБЖУ дня не «уехали». */
export function swapMeal(items: IndexItem[], plan: WeekPlan, day: number, slot: Slot, history: Set<string>): WeekPlan {
  const P = pools(items, plan.settings)
  const inPlan = new Set(plan.days.flatMap((d) => d.meals.map((m) => m.id)))
  const tg = macroTargets(plan.settings)
  const base = plan.days[day].meals.reduce((a, ml) => {
    const it = ml.slot !== slot ? P.byId.get(ml.id) : undefined
    return it ? add(a, mac(it)) : a
  }, ZERO)
  const pool = (P[slot].length ? P[slot] : P.lunch).filter((i) => !inPlan.has(i.id))
  const ranked = pool
    .map((i) => [i, -dayLoss(add(base, mac(i)), tg) - (history.has(i.id) ? 25 : 0) + i.tr / 20 + Math.random() * 18] as const)
    .sort((a, b) => b[1] - a[1])
  const pick = ranked[0]?.[0]
  if (!pick) return plan
  const days = plan.days.map((d, k) =>
    k !== day ? d : { meals: d.meals.map((ml) => (ml.slot === slot ? { slot, id: pick.id, why: explain(pick, slot, plan.settings) } : ml)) },
  )
  return { ...plan, days }
}

export function dayTotals(items: Map<string, IndexItem>, d: Day) {
  return d.meals.reduce(
    (a, m) => {
      const i = items.get(m.id)
      if (!i) return a
      return { kc: a.kc + (i.kc || 0), p: a.p + (i.p || 0), f: a.f + (i.f || 0), c: a.c + (i.cb || 0) }
    },
    { kc: 0, p: 0, f: 0, c: 0 },
  )
}

/** Суточная норма по Миффлину — Сан-Жеору с поправкой на цель. */
export function calcKcal(sex: 'm' | 'f', weight: number, height: number, age: number, activity: number, goal: Goal) {
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'm' ? 5 : -161)
  const tdee = bmr * activity
  const k = goal === 'lose' ? 0.85 : goal === 'gain' ? 1.12 : 1
  return Math.round((tdee * k) / 50) * 50
}
