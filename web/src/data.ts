import { searchTerm, stem, tokenize } from './text'
import type { Video } from './VideoPlayer'
import { configured, deviceId, sb } from './supa'
import type MiniSearch from 'minisearch'
import { devApprovedCards, devRecipeContent } from './userRecipes'

export type IndexItem = {
  id: string
  t: string
  c: string[]
  g: string[]
  m: string[]
  min: number | null
  tp: number | null
  tr: number
  im: 0 | 1
  v: 0 | 1
  d: string
  vw: number
  ing: string[]
  sk: string[]
  ns: number
  srv: number | null
  srvE: 0 | 1
  kc: number | null
  p: number | null
  f: number | null
  cb: number | null
  pl: string[]
  fr: 0 | 1
  /** Отличие от рецептов с тем же названием: «манка, изюм» */
  sub?: string
  /** внешнее фото (рецепты владельцев из витрины recipe_cards) */
  img?: string | null
}

export type Source = { url: string; name: string; kind: string; platform: string; date: string }

export type Recipe = {
  id: string
  title: string
  intro: string
  servings: number | null
  ingredients: { t: string; g?: string }[]
  steps: string[]
  modes: string[]
  modes_short: string[]
  temp_text: string | null
  time_text: string | null
  temps: number[]
  minutes: number | null
  approx_minutes: number | null
  servings_estimated: boolean
  nutrition: null | { kcal: number; p: number; f: number; c: number; kcal100: number; p100: number; f100: number; c100: number; weight: number; servings: number; servings_estimated: boolean; coverage: number }
  wm?: string
  categories: string[]
  tags: string[]
  has_video: boolean
  videos?: Video[]
  date: string
  views: string | null
  sources: Source[]
  trust: number
  trust_parts: [string, number][]
}

export type Meta = {
  built: string
  total: number
  sources: { name: string; kind: string; platform: string; count: number }[]
}

export { stem, tokenize }

type Loaded = { meta: Meta; items: IndexItem[]; byId: Map<string, IndexItem> }
let indexPromise: Promise<Loaded> | null = null

/** «АЭРОГРИЛЬ / AIR CRISP» → «Аэрогриль» (как в индексе). */
export function shortMode(m: string) {
  const r = m.split(' / ')[0].trim()
  return r.charAt(0) + r.slice(1).toLowerCase()
}

/** Внешние фото рецептов владельцев: id → https-URL. */
const extImg = new Map<string, string>()

/** Карточка из витрины recipe_cards → IndexItem (режимы — в коротком виде, фото — внешнее). */
function normCard(c: IndexItem): IndexItem {
  const img = typeof c.img === 'string' && /^https:\/\//.test(c.img) ? c.img : null
  if (img) extImg.set(c.id, img)
  return {
    ...c,
    c: c.c?.length ? c.c : ['Другое'],
    g: c.g || [],
    m: (c.m || []).map(shortMode),
    ing: c.ing || [],
    sk: c.sk?.length ? c.sk : ['owner'],
    pl: c.pl || [],
    im: img ? 1 : 0,
    img,
  }
}

/** Одобренные рецепты владельцев. Не дольше 3 с — каталог не должен ждать медленную сеть. */
async function loadCards(): Promise<IndexItem[]> {
  if (!configured) return import.meta.env.DEV ? devApprovedCards() : []
  const req = sb()
    .then((c) => c.from('recipe_cards').select('card').order('created_at', { ascending: false }).limit(1000))
    .then(({ data, error }) => (error || !data ? [] : (data as { card: IndexItem }[]).map((x) => x.card).filter((x) => x && x.id && x.t)))
    .catch(() => [] as IndexItem[])
  return Promise.race([req, new Promise<IndexItem[]>((r) => setTimeout(() => r([]), 3000))])
}

export function loadIndex() {
  if (!indexPromise) {
    const cards = loadCards()
    indexPromise = fetch(`${import.meta.env.BASE_URL}data/index.json`)
      .then((r) => r.json())
      .then(async ({ meta, items }: { meta: Meta; items: IndexItem[] }) => {
        const ids = new Set(items.map((i) => i.id))
        const own = (await cards).map(normCard).filter((c) => !ids.has(c.id))
        const all = own.length ? [...own, ...items] : items
        const byId = new Map(all.map((i) => [i.id, i]))
        return { meta: own.length ? { ...meta, total: meta.total + own.length } : meta, items: all, byId }
      })
  }
  return indexPromise
}

let searchPromise: Promise<MiniSearch<IndexItem>> | null = null
let searchReady: MiniSearch<IndexItem> | null = null
/**
 * Поисковый индекс строится один раз и не на старте: библиотека и индекс нужны только
 * для поиска, поэтому главная открывается без них. App просит построить его в простое.
 */
export function getSearch(): Promise<MiniSearch<IndexItem>> {
  if (!searchPromise)
    searchPromise = Promise.all([import('minisearch'), loadIndex()]).then(([{ default: MS }, { items }]) => {
      const search = new MS<IndexItem>({
        fields: ['t', 'ingText', 'catText', 'modeText'],
        storeFields: [],
        extractField: (doc, field) => {
          if (field === 'ingText') return doc.ing.join(' ')
          if (field === 'catText') return [...doc.c, ...doc.g].join(' ')
          if (field === 'modeText') return doc.m.join(' ')
          // @ts-expect-error dynamic
          return doc[field]
        },
        tokenize,
        processTerm: searchTerm,
        // опечатки прощаем только в длинных словах: в коротких «исправление» находит не то
        searchOptions: { prefix: (t) => t.length >= 3, fuzzy: (t) => (t.length >= 6 ? 0.2 : false), boost: { t: 3, ingText: 1.5, catText: 1, modeText: 1 }, combineWith: 'AND' },
      })
      search.addAll(items)
      searchReady = search
      return search
    })
  return searchPromise
}
/** Готовый индекс или null, если ещё строится. */
export const searchIfReady = () => searchReady

const recipeCache = new Map<string, Promise<Recipe>>()
/** Полный рецепт выдаёт только сервер — после проверки подписки. В браузере не сохраняется. */
export function loadRecipe(item: IndexItem): Promise<Recipe> {
  if (!recipeCache.has(item.id)) {
    const local = !configured && import.meta.env.DEV ? devRecipeContent(item.id) : null
    const p: Promise<Recipe> = (
      local
        ? Promise.resolve(local)
          : !configured
            ? // бесплатный режим (сервер не подключён): рецепт лежит открытым файлом
              fetch(`${import.meta.env.BASE_URL}data/r/${item.id}.json`).then((r) => (r.ok ? (r.json() as Promise<Recipe>) : Promise.reject(new Error('not_found'))))
            : sb()
              .then((c) => c.rpc('get_recipe', { p_id: item.id, p_device: deviceId() }))
              .then(({ data, error }) => {
                if (error) {
                  recipeCache.delete(item.id)
                  throw error
                }
                return data as Recipe
              })
    ).then((r) => ({ ...r, modes_short: (r.modes_short || []).map((m) => (m.includes(' / ') ? shortMode(m) : m)) }))
    recipeCache.set(item.id, p)
  }
  return recipeCache.get(item.id)!
}
export const clearRecipeCache = () => recipeCache.clear()

export const imgUrl = (id: string) => extImg.get(id) || `${import.meta.env.BASE_URL}img/${id}.webp`

export const CATEGORIES: { name: string; emoji: string }[] = [
  { name: 'Курица и птица', emoji: '🍗' },
  { name: 'Мясо', emoji: '🥩' },
  { name: 'Рыба и морепродукты', emoji: '🐟' },
  { name: 'Овощи и гарниры', emoji: '🥔' },
  { name: 'Выпечка', emoji: '🥧' },
  { name: 'Десерты', emoji: '🍫' },
  { name: 'Завтраки', emoji: '🍳' },
  { name: 'Закуски', emoji: '🧀' },
  { name: 'Супы', emoji: '🍲' },
  { name: 'Сушка и заготовки', emoji: '🍎' },
  { name: 'Другое', emoji: '🍽️' },
]

export const MODES = ['Аэрогриль', 'Выпечка', 'Гриль', 'Запекание', 'Ручной', 'Барбекю', 'Фритюр', 'Су-вид', 'Пар', 'Томление', 'Дегидратор', 'Рис', 'Пицца', 'Йогурт', 'Расстойка']

export function trustLevel(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: 'Проверен', cls: 'tr-high' }
  if (score >= 60) return { label: 'Надёжный', cls: 'tr-mid' }
  return { label: 'Базовый', cls: 'tr-low' }
}

export function fmtMinutes(m: number | null) {
  if (!m) return null
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} ч ${r} мин` : `${h} ч`
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
