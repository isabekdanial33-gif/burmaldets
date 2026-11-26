// Подборки — только из того, что уже есть в индексе (теги, КБЖУ, режимы, ингредиенты). Новых данных не выдумываем.
import type { IndexItem } from './data'

export type Collection = { slug: string; title: string; emoji: string; sub: string; test: (i: IndexItem) => boolean; sort?: (a: IndexItem, b: IndexItem) => number }

const HOLIDAY = /праздн|новогод|рождеств|целиком|окорок|буженин|холодец|заливн|фарширован|канапе|тарталет|утк[аиу]|гус[ья]|каре ягн|рульк|рулет из|мясной рулет|торт/i
const KIDS = /детск|для детей|малыш|наггетс|сосиск[аи] в тесте|сырник|фрикадел|ленив|котлетк|оладь|оладушк|панкейк|блинчик|творожн(ая|ые) запеканк|запеканк[аи]? творожн|маффин|печень[еяи]|куриные палочки|рыбные палочки/i
const NOT_FOR_KIDS = /остр|чили|халапен|алкогол|вин[оа]м?\b|коньяк|пив[оа]|\bром\b|виски|аджик|табаско|настойк|ликер|ликёр/i

const pop = (a: IndexItem, b: IndexItem) => b.vw - a.vw || b.tr - a.tr

export const COLLECTIONS: Collection[] = [
  { slug: 'holiday', title: 'На праздничный стол', emoji: '🎉', sub: 'Утка, запечённое целиком, рулеты и закуски', test: (i) => i.g.includes('Праздничное') || HOLIDAY.test(i.t) },
  {
    slug: 'kids',
    title: 'Для детей',
    emoji: '🧒',
    sub: 'Сырники, котлетки, наггетсы — без острого',
    test: (i) => (i.g.includes('Детям') || KIDS.test(i.t)) && !NOT_FOR_KIDS.test(i.t + ' ' + i.ing.join(' ')),
  },
  {
    slug: 'protein',
    title: 'Белковые',
    emoji: '💪',
    sub: '30 г белка и больше на порцию',
    // и белок — заметная доля калорий (≥ 20%), иначе в подборку попадает целый торт «на одну порцию»
    test: (i) => (i.p ?? 0) >= 30 && !!i.kc && ((i.p ?? 0) * 4) / i.kc >= 0.2 && !i.c.includes('Десерты'),
  },
  { slug: 'light', title: 'До 400 ккал', emoji: '🥗', sub: 'Лёгкие блюда на порцию', test: (i) => !!i.kc && i.kc <= 400 },
  { slug: 'sousvide', title: 'Су-вид', emoji: '🌡️', sub: 'Режим СУ-ВИД: точная низкая температура', test: (i) => i.m.includes('Су-вид') },
  { slug: 'five', title: 'Из 5 ингредиентов', emoji: '🖐️', sub: 'Пять продуктов и меньше', test: (i) => i.ing.length > 0 && i.ing.length <= 5 },
  { slug: 'for2', title: 'Для двоих', emoji: '💞', sub: 'Рецепты на 1–2 порции', test: (i) => !!i.srv && i.srv <= 2 },
]

export const collectionBySlug = (s: string) => COLLECTIONS.find((c) => c.slug === s)

const cache = new WeakMap<IndexItem[], Map<string, IndexItem[]>>()
/** Рецепты подборки (отсортированы), с кэшем на весь массив индекса. */
export function collectionItems(items: IndexItem[], c: Collection): IndexItem[] {
  let m = cache.get(items)
  if (!m) cache.set(items, (m = new Map()))
  let list = m.get(c.slug)
  if (!list) m.set(c.slug, (list = items.filter(c.test).sort(c.sort || pop)))
  return list
}
