import { stem, tokenize } from './text.ts'

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()

/** Есть на любой кухне — никогда не считаем «недостающим». Только то, без чего блюдо не «ломается». */
export function isBasic(raw: string): boolean {
  const t = norm(raw)
  if (/^соль/.test(t) && !/нитрит/.test(t)) return true
  // необязательное: «масло или желток для румяной корочки», «для смазывания»
  if (/(для (румян\S* )?корочк|для смазыв|для подачи|по желанию)/.test(t)) return true
  if (/(^|\s)(вода|воды|кипят|лед|льда)(\s|$|,)|^кипят/.test(t) && !/(минерал|газир|кокосов|розов|тоник)/.test(t)) return true
  if (/(специи|специй|приправ)/.test(t) && !/(для плова|карри|хмели|итальянск|прованс)/.test(t)) return true
  // перец — только чёрный/молотый, не болгарский и не чили
  if (/перец/.test(t) && /^(перец|черн|молот|свежемолот|бел|душист)/.test(t) && !/(болгар|сладк|чили|красн|остр|халап|лимон)/.test(t)) return true
  // масло — только растительное/для жарки и смазки, не сливочное и не кунжутное
  if (/(^|\s)масл(о|а)(\s|$)/.test(t) && !/(сливоч|кунжут|кокос|арахис|топлен|трюфел|оливки|маслин|желток)/.test(t)) {
    if (t === 'масло' || /(растит|подсолн|оливков|для жарки|для фритюр|для смазыв|рафинир|для корочк)/.test(t)) return true
  }
  return false
}

/** Продукты, которые у многих есть «всегда», но не у всех. Пользователь сам отмечает, что они есть. */
export const STAPLES: { key: string; label: string; re: RegExp }[] = [
  { key: 'flour', label: 'Мука', re: /(^|\s)мука(?!.*(рисов|миндал|кокос|кукуруз|овсян|нутов|гречн|ржан|цельнозерн|льнян))|пшеничн\S* мук/ },
  { key: 'sugar', label: 'Сахар', re: /^(сахар(\s|$|,)|сахарный песок|сахар-песок)|(коричнев|тростник|бел)\S* сахар/ },
  { key: 'butter', label: 'Сливочное масло', re: /(сливочн\S* масл|масл\S* сливочн)/ },
  { key: 'leaven', label: 'Разрыхлитель, сода', re: /^(разрыхлит|сода)/ },
  { key: 'vanilla', label: 'Ванилин', re: /^(ванилин|ванильный сахар)/ },
  { key: 'garlic', label: 'Чеснок', re: /^чеснок/ },
  { key: 'greens', label: 'Зелень', re: /^зелень/ },
  { key: 'spices', label: 'Паприка, корица', re: /^(паприка|корица)/ },
]

// Разные слова одного продукта → одна основа: «курица» = «куриное филе», «картошка» = «картофель».
const SYN: Record<string, string> = {
  куриц: 'кур', курин: 'кур', кур: 'кур', цыплят: 'кур', цыпленк: 'кур', бройлер: 'кур',
  картофел: 'картоф', картошк: 'картоф', картофельн: 'картоф', картоф: 'картоф',
  помидор: 'томат', томат: 'томат', черр: 'томат', томатн: 'соус-томатн',
  яйц: 'яйц', яиц: 'яйц', яичн: 'яйц', желтк: 'яйц', желток: 'яйц',
  говядин: 'говяд', говяж: 'говяд', телятин: 'говяд',
  свинин: 'свин', свин: 'свин', свиной: 'свин',
  грибн: 'гриб', гриб: 'гриб', шампиньон: 'гриб',
  сырн: 'сыр', сыр: 'сыр',
  морков: 'морков', морковк: 'морков',
  кабачк: 'кабачк', кабачок: 'кабачк', цукин: 'кабачк',
  индейк: 'индейк', индюш: 'индейк',
  лосос: 'лосос', семг: 'лосос', сёмг: 'лосос',
}
// «сырое яйцо», «бекон сырокопчёный» — это не сыр; «томатная паста» — не помидор
const NOT_FOOD = /^(сыр(ой|ое|ая|ые|ого|ых|ом)|сырокопч\S*|сыровял\S*|свеж\S*|отварн\S*|варен\S*|замороженн\S*|крупн\S*|мелк\S*|средн\S*|любой|любые|филе)$/

export function keyOf(s: string): string[] {
  const words = tokenize(s).filter((w) => w.length > 2 && !NOT_FOOD.test(w))
  let k = words.map((w) => SYN[stem(w)] ?? SYN[w] ?? stem(w))
  // «куриное яйцо» — это яйцо, а не курица
  if (k.includes('яйц')) k = k.filter((x) => x !== 'кур')
  return [...new Set(k)]
}

const sameFood = (a: string, b: string) => {
  if (a === b) return true
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  return s.length >= 4 && l.startsWith(s)
}

/**
 * Специи, сушёные травы, зелень для подачи — не повод предлагать блюдо («есть паприка» ≠ «можно сделать картошку по-деревенски»)
 * и не настоящая нехватка. А посуда («корзина», «чаша», «решётка») иногда попадает в список ингредиентов по ошибке источника.
 */
const MINOR = [
  /(^|\s)(паприк\S*|розмарин\S*|тимьян\S*|чабрец\S*|орегано|травы|трав|куркум\S*|зира|кумин|кориандр\S*|корица|корицы|ванил\S*|мускат\S*|карри|хмели\S*|лавров\S*|гвоздик\S*|кардамон\S*|кунжут\S*|петрушк\S*|укроп\S*|кинза|кинзы|мят\S*|зелень|зелени|сода|разрыхлит\S*)(\s|$|,)/,
  /(чеснок|чесночн\S*)\s+(сушен\S*|молот\S*|порошок|гранулир\S*)|сушен\S* чеснок|порошок|хлопья чили|имбирь молот\S*|молот\S* имбирь/,
]
const GEAR = /^(низк\S* |высок\S* )?(корзин|решетк|чаша|форма|пергамент|шпажк|фольг|бумаг|рукав|силикон|коврик|противен|зубочист|пакет)/
export const isMinor = (raw: string) => {
  const t = norm(raw)
  return MINOR.some((re) => re.test(t)) || GEAR.test(t)
}

export type FridgeHit<T> = { i: T; got: string[]; missing: string[]; total: number; fromFridge: number; mainMissing: string[] }

/**
 * Подбор: выше те, где использовано больше продуктов из холодильника и меньше не хватает.
 * Продукт из названия («Картофель по-деревенски» → картофель) — основа блюда: если её нет, рецепт уходит вниз.
 */
export function fridgeMatch<T extends { ing: string[]; tr: number; t: string }>(items: T[], have: string[], staples: string[], limit = 120): FridgeHit<T>[] {
  const haveKeys = have.map(keyOf).filter((k) => k.length)
  if (!haveKeys.length) return []
  const st = STAPLES.filter((s) => staples.includes(s.key))
  const isStaple = (x: string) => st.some((s) => s.re.test(norm(x)))
  /** Индекс продукта из холодильника, которым закрывается ингредиент, или -1. */
  const fridgeIdx = (ing: string) => {
    const k = keyOf(ing)
    return haveKeys.findIndex((hk) => hk.every((w) => k.some((x) => sameFood(x, w))))
  }
  const out: FridgeHit<T>[] = []
  for (const i of items) {
    const main = i.ing.filter((x) => !isBasic(x) && !isMinor(x))
    const titleK = keyOf(i.t)
    const isCore = (x: string) => keyOf(x).some((k) => titleK.some((tk) => sameFood(k, tk)))
    const got: string[] = []
    const missing: string[] = []
    const mainMissing: string[] = []
    const used = new Set<number>()
    for (const x of main) {
      const f = fridgeIdx(x)
      if (f >= 0) {
        got.push(x)
        used.add(f)
      } else if (isStaple(x)) got.push(x)
      else {
        missing.push(x)
        if (isCore(x)) mainMissing.push(x)
      }
    }
    // показываем, только если в рецепте есть хотя бы один настоящий продукт именно из холодильника
    if (used.size) {
      missing.sort((a, b) => Number(mainMissing.includes(b)) - Number(mainMissing.includes(a)))
      out.push({ i, got, missing, total: main.length, fromFridge: used.size, mainMissing })
    }
  }
  const score = (r: FridgeHit<T>) => r.missing.length + 3 * r.mainMissing.length - (r.fromFridge - 1)
  return out
    .sort((a, b) => score(a) - score(b) || b.fromFridge - a.fromFridge || a.missing.length - b.missing.length || b.i.tr - a.i.tr)
    .slice(0, limit)
}

/** Подсказки продуктов: частые ингредиенты без базовых и без «есть дома»; «яйцо», «яйца», «яйцо куриное» — одна подсказка. */
export function fridgeVocab(items: { ing: string[] }[]): string[] {
  const groups = new Map<string, { n: number; names: Map<string, number> }>()
  for (const i of items)
    for (const x of i.ing) {
      if (isBasic(x) || isMinor(x) || x.length >= 28 || STAPLES.some((s) => s.re.test(norm(x)))) continue
      const k = keyOf(x).sort().join(' ')
      if (!k) continue
      const g = groups.get(k) ?? { n: 0, names: new Map() }
      g.n++
      g.names.set(x, (g.names.get(x) || 0) + 1)
      groups.set(k, g)
    }
  return [...groups.values()]
    .sort((a, b) => b.n - a.n)
    .map((g) => [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0])
}
