// Локальный мозг Бурмалдеца: работает без интернета и без лимитов.
// 1) Быстрые команды (дальше, таймер, добавь в корзину…) — отвечает сам, мгновенно.
// 2) Если Gemini недоступен — отвечает на всё, что может, по каталогу рецептов.
import { getContacts, prepareCall } from './contacts'
import { getState } from '../store'
import { EXEC, findRecipes, fullRecipe, recipeBrief, sameFood, short, stepResult } from './tools'
import { session } from './session'
import { isAndroid } from './bridge'
import { getMode, type Mode } from './mode'
import { news, rates, weather, wiki } from './info'
import { getName, memoryFacts } from './memory'
import { setReminder } from './reminders'
import { inCity, skill } from './skills'
import { nativeCall } from './bridge'

let lastSaid = ''
let stopwatch = 0
export const rememberSaid = (t: string) => (lastSaid = t)

export type Emotion = 'спокойно' | 'радость' | 'думаю' | 'удивление' | 'грусть' | 'слушаю' | 'гордость'
export type Reply = { text: string; emotion: Emotion }

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”.!?;:()]/g, ' ')
    .replace(/,/g, ' , ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(бурмалд\S*|бур молодец|бор молодец|чекун\S*|чеку нет|чеку конец|шеф|chef)\s*,?\s*/, '')
    .replace(/\s*,$/, '')

const NUM: Record<string, number> = {
  ноль: 0, одну: 1, одна: 1, один: 1, первый: 1, первую: 1, первое: 1, две: 2, два: 2, второй: 2, вторую: 2, второе: 2, три: 3, третий: 3, третью: 3,
  четыре: 4, четвертый: 4, пять: 5, пятый: 5, шесть: 6, шестой: 6, семь: 7, седьмой: 7, восемь: 8, восьмой: 8, девять: 9, девятый: 9, десять: 10, десятый: 10,
  одиннадцать: 11, двенадцать: 12, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, девяносто: 90, сто: 100,
  полторы: 1.5, полтора: 1.5, пару: 2, пара: 2,
}
function numberIn(s: string): number | undefined {
  const d = s.match(/(\d+(?:[.,]\d+)?)/)
  if (d) return parseFloat(d[1].replace(',', '.'))
  let total = 0
  let found = false
  for (const w of s.split(' ')) if (w in NUM) {
    total += NUM[w]
    found = true
  }
  return found ? total : undefined
}

/** «на 5 минут», «полчаса», «час двадцать», «тридцать секунд» → секунды */
export function parseDuration(s: string): number | undefined {
  if (/полчаса/.test(s)) return 1800
  if (/полтора часа/.test(s)) return 5400
  let sec = 0
  const h = s.match(/(\S+)?\s*час/)
  const m = s.match(/((?:\S+\s)?\S+)\s*мин/)
  const c = s.match(/((?:\S+\s)?\S+)\s*сек/)
  if (h) sec += (h[1] ? numberIn(h[1]) ?? 1 : 1) * 3600
  if (m) sec += (numberIn(m[1]) ?? 0) * 60
  if (c) sec += numberIn(c[1]) ?? 0
  if (!sec && /таймер|засеки/.test(s)) {
    const n = numberIn(s)
    if (n) sec = n * 60
  }
  return sec > 0 ? Math.round(sec) : undefined
}
const humanDur = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pl = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c)
  return [h && `${h} ${pl(h, 'час', 'часа', 'часов')}`, m && `${m} ${pl(m, 'минуту', 'минуты', 'минут')}`, s && `${s} ${pl(s, 'секунду', 'секунды', 'секунд')}`].filter(Boolean).join(' ')
}

/** «сметану» → «сметана», «томатную пасту» → «томатная паста»: в корзине — как на ценнике. */
const NOT_ACC = /^(рагу|кенгуру|какао|кофе|меню|филе|пюре|желе|соте|какую|ту)$/
const nominative = (item: string) =>
  item
    .split(' ')
    .map((w) => (NOT_ACC.test(w) ? w : w.replace(/(ую|юю)$/, (m) => (m === 'ую' ? 'ая' : 'яя')).replace(/([бвгджзклмнпрстфхцчшщ])у$/, '$1а').replace(/([бвгджзклмнпрстфхцчшщ])ю$/, '$1я')))
    .join(' ')

/** «яйца и сметану, молоко» → ['яйца', 'сметана', 'молоко'] */
const splitItems = (s: string) =>
  s
    .split(/,|\sи\s|\sа также\s|\sещё\s|\sеще\s/)
    .map((x) => x.replace(/^(мне|пожалуйста|ещё|еще|немного|пару)\s+/g, '').trim())
    .filter((x) => x.length > 1 && !/^(в|во|на|из|у|мне)$/.test(x))
    .map(nominative)

let lastFound: { id: string; title: string }[] = []

const listTitles = (r: { title: string }[]) =>
  r
    .slice(0, 3)
    .map((x, i) => `${['Первый', 'Второй', 'Третий'][i]}: ${x.title}`)
    .join('. ')

async function readStep(prefix = ''): Promise<Reply> {
  const r = stepResult() as Record<string, unknown>
  if (r.error) return { text: 'Мы сейчас ничего не готовим. Скажите, например: «Бурмалдец, найди курицу на ужин», а потом «готовим первый».', emotion: 'спокойно' }
  const last = r.is_last ? ' Это последний шаг.' : ''
  return { text: `${prefix}Шаг ${r.step_number} из ${r.total_steps}. ${r.text}${last}`, emotion: 'спокойно' }
}

const CUISINE_MUSIC: [RegExp, string][] = [
  [/паст|пицц|лазань|ризотто|итальян|карбонар|болонь/, 'italian dinner jazz'],
  [/суши|ролл|азиат|терияк|рамен|кимчи|корей|япон/, 'lofi japanese city pop'],
  [/плов|самс|манты|лагман|шашлык|казах|узбек|бешбармак/, 'восточная инструментальная музыка'],
  [/бургер|барбекю|крыл|ребр|стейк|гриль|наггетс/, 'classic rock bbq'],
  [/торт|кекс|пирог|печень|выпеч|десерт|маффин|сырник|блин|завтрак/, 'cozy acoustic morning'],
  [/тако|буррито|мексик|начос/, 'latin guitar'],
  [/франц|круассан|жульен/, 'french cafe accordion'],
]

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10
  const b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}

/** «жене» → «Айгерим», если в памяти есть «мою жену зовут Айгерим» / «жена — Айгерим». */
function nameFromMemory(who: string): string | null {
  const w = who.toLowerCase().replace(/ё/g, 'е').trim().split(/\s+/)[0]
  if (w.length < 3) return null
  const stem = w.slice(0, Math.max(3, w.length - 2))
  for (const f of memoryFacts()) {
    const low = f.toLowerCase().replace(/ё/g, 'е')
    if (!low.includes(stem)) continue
    const m = f.match(/(?:зовут|—|-|:)\s*([А-ЯЁA-Z][а-яёa-z]+(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)/) || f.match(/([А-ЯЁ][а-яё]{2,})/)
    if (m) return m[1]
  }
  return null
}

/** «сколько будет 25 умножить на 4», «15 процентов от 3000», «корень из 144» — считаем сами, мгновенно. */
const OPS: [RegExp, string][] = [
  [/\s*(плюс|\+|прибавить)\s*/g, '+'],
  [/\s*(минус|-|отнять)\s*/g, '-'],
  [/\s*(умножить на|умножь на|помножить на|умноженное на|\*|x|х)\s*/g, '*'],
  [/\s*(разделить на|делить на|поделить на|деленное на|\/|:)\s*/g, '/'],
]
function arithmetic(s: string): string | null {
  let q = s.replace(/^(сколько будет|посчитай|вычисли|сколько|реши)\s+/, '').replace(/[?=]/g, '').trim()
  if (!/\d/.test(q)) return null
  const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4))).replace('.', ',')
  let m = q.match(/^(\d+(?:[.,]\d+)?) процент\S* от (\d+(?:[.,]\d+)?)$/)
  if (m) return `${fmtN((parseFloat(m[1].replace(',', '.')) * parseFloat(m[2].replace(',', '.'))) / 100)}.`
  m = q.match(/^(?:квадратный )?корень из (\d+(?:[.,]\d+)?)$/)
  if (m) return `${fmtN(Math.sqrt(parseFloat(m[1].replace(',', '.'))))}.`
  m = q.match(/^(\d+(?:[.,]\d+)?) в (квадрате|кубе)$/)
  if (m) return `${fmtN(parseFloat(m[1].replace(',', '.')) ** (m[2] === 'квадрате' ? 2 : 3))}.`
  for (const [re, op] of OPS) q = q.replace(re, op)
  q = q.replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '')
  if (!/^[\d.+\-*/()]+$/.test(q) || !/[+\-*/]/.test(q) || q.length > 40) return null
  try {
    const v = Function(`"use strict";return (${q})`)() as number
    return Number.isFinite(v) ? `${fmtN(v)}.` : null
  } catch {
    return null
  }
}

/** Строгие быстрые команды. null — пусть думает Gemini (если доступен). */
export async function quick(raw: string): Promise<Reply | null> {
  const s0 = norm(raw)
  if (!s0) return null
  // запятые нужны только для списков продуктов; в остальных проверках их нет
  const s = s0.replace(/ , /g, ' ')
  const cookMode = getMode() === 'cook'
  const cooking = cookMode && !!session().recipe

  // --- готовка шаг за шагом ---
  if (cooking) {
    if (/^(дальше|далее|следующ\S*( шаг)?|вперед|некст|го|поехали|сделал\S*|готово|ок дальше)$/.test(s)) {
      const r = (await EXEC.cooking_step({ action: 'next' })) as Record<string, unknown>
      if (r.done) return { text: 'Это был последний шаг. Готово! Приятного аппетита. Отметить блюдо приготовленным?', emotion: 'гордость' }
      return readStep()
    }
    if (/^(назад|предыдущ\S*( шаг)?|верни\S*|обратно)$/.test(s)) {
      await EXEC.cooking_step({ action: 'prev' })
      return readStep()
    }
    if (/^(повтори\S*|еще раз|ещё раз|не расслышал\S*|что\??|какой (сейчас )?шаг|где мы)$/.test(s)) return readStep()
    const g = s.match(/^(?:перейди |открой )?(?:к )?шаг\S* (?:номер )?(\S+)$/)
    if (g && numberIn(g[1])) {
      await EXEC.cooking_step({ action: 'goto', number: numberIn(g[1]) })
      return readStep()
    }
  }

  // --- таймер ---
  if (/таймер|засеки|засечь|поставь .*(минут|секунд)/.test(s) && !/отмени|убери|сколько остал|засеки время|секундомер|напомни/.test(s)) {
    const sec = parseDuration(s)
    if (!sec) return { text: 'На сколько поставить таймер?', emotion: 'слушаю' }
    const r = (await EXEC.set_timer({ seconds: sec, label: session().recipe?.title || 'Бурмалдец' })) as Record<string, unknown>
    return { text: `Готово, таймер на ${humanDur(sec)}${r.where === 'часы телефона' ? ' в часах телефона' : ''}.`, emotion: 'радость' }
  }

  // --- корзина ---
  let m = s0.match(/^(?:добавь|закинь|запиши|положи|внеси)\s+(.+?)\s+(?:в|во)\s+(?:корзину|список( покупок)?|покупки)$/) || s0.match(/^(?:купить|надо купить|нужно купить)\s+(.+)$/)
  if (m) {
    const items = splitItems(m[1])
    if (items.length) {
      await EXEC.cart_add({ items })
      return { text: pick(['Добавил в список покупок: ', 'Записал: ', 'Есть, в корзине: ']) + items.join(', ') + '.', emotion: 'радость' }
    }
  }
  if (/^(?:добавь|закинь) (?:все )?(?:ингредиенты|продукты)(?: этого| для этого)?(?: рецепта)?(?: в корзину| в список)?$/.test(s) && cooking) {
    const r = (await EXEC.cart_add_recipe_ingredients({})) as Record<string, unknown>
    return { text: `Добавил ингредиенты рецепта «${r.recipe}» в список покупок.`, emotion: 'радость' }
  }
  if (/^(что|чего) (у меня )?(в корзине|в списке( покупок)?|надо купить|нужно купить|купить)$|^(прочитай|покажи) (корзину|список покупок)$/.test(s)) {
    const r = (await EXEC.cart_list({})) as { to_buy: string[] }
    return r.to_buy.length
      ? { text: `В списке ${r.to_buy.length}: ${r.to_buy.slice(0, 12).join(', ')}${r.to_buy.length > 12 ? ' и ещё' : ''}.`, emotion: 'спокойно' }
      : { text: 'Список покупок пуст.', emotion: 'спокойно' }
  }
  if (/^(очисти|почисти|удали все из) (корзин\S*|список\S*( покупок)?)$/.test(s)) {
    await EXEC.cart_clear({})
    return { text: 'Список покупок очищен.', emotion: 'спокойно' }
  }
  m = s0.match(/^(?:убери|удали|вычеркни)\s+(.+?)\s+из\s+(?:корзины|списка( покупок)?|покупок)$/)
  if (m) {
    const r = (await EXEC.cart_remove({ items: splitItems(m[1]) })) as { removed: string[] }
    return r.removed.length ? { text: 'Убрал: ' + r.removed.join(', ') + '.', emotion: 'спокойно' } : { text: 'Такого в списке нет.', emotion: 'удивление' }
  }

  // --- холодильник (режим повара) ---
  m = !cookMode ? null : s0.match(/^(?:есть ли|а есть|у меня есть ли|осталось ли|остались ли|остался ли|осталась ли)\s+(?:у меня\s+)?(?:в холодильнике\s+)?(.+?)(?:\s+в холодильнике)?$/)
  if (m) {
    const items = splitItems(m[1])
    const r = (await EXEC.fridge_check({ items })) as { checked: { item: string; in_fridge: boolean }[]; note?: string }
    if (r.note) return { text: 'Холодильник в приложении пока пуст — скажите, что у вас есть, например: «в холодильнике есть яйца и молоко».', emotion: 'спокойно' }
    const yes = r.checked.filter((x) => x.in_fridge).map((x) => x.item)
    const no = r.checked.filter((x) => !x.in_fridge).map((x) => x.item)
    return { text: [yes.length && `Есть: ${yes.join(', ')}.`, no.length && `Нет: ${no.join(', ')}. Добавить в покупки?`].filter(Boolean).join(' '), emotion: no.length ? 'думаю' : 'радость' }
  }
  m = !cookMode ? null : s0.match(/^(?:в холодильнике есть|у меня есть|дома есть|купил\S*)\s+(.+)$/)
  if (m) {
    const r = (await EXEC.fridge_add({ items: splitItems(m[1]) })) as { added: string[] }
    return { text: r.added.length ? `Отметил в холодильнике: ${r.added.join(', ')}.` : 'Это уже отмечено в холодильнике.', emotion: 'радость' }
  }
  m = !cookMode ? null : s0.match(/^(?:закончил\S*|кончил\S*|нет больше)\s+(.+)$/)
  if (m) {
    const r = (await EXEC.fridge_remove({ items: splitItems(m[1]) })) as { removed: string[] }
    return { text: r.removed.length ? `Убрал из холодильника: ${r.removed.join(', ')}. Добавить в покупки?` : 'Этого и так не было в холодильнике.', emotion: 'спокойно' }
  }
  if (cookMode && /^что (у меня )?(есть )?в холодильнике$/.test(s)) {
    const f = getState().fridge
    return { text: f.length ? `В холодильнике: ${f.join(', ')}.` : 'Холодильник в приложении пуст.', emotion: 'спокойно' }
  }

  // --- выбор из найденного ---
  m = s.match(/^(?:давай|готовим|выбираю|возьмем|возьму|открой|хочу)\s+(первый|второй|третий|первое|второе|третье|1|2|3)(?: рецепт| вариант)?$/)
  if (m && cookMode && lastFound.length) {
    const n = (numberIn(m[1]) || 1) - 1
    const f = lastFound[n]
    if (f) {
      await EXEC.start_cooking({ id: f.id })
      return readStep(`Готовим «${f.title}». Скажите «дальше», когда будете готовы к следующему шагу. `)
    }
  }

  // --- текущий рецепт: вопросы ---
  const cur = cookMode ? session().recipe : null
  if (cur) {
    const b = recipeBrief(cur)
    if (/калори|ккал|кбжу|белк|жир|углевод/.test(s) && s.split(' ').length < 9)
      return b.nutrition_per_portion
        ? { text: `На порцию примерно ${b.nutrition_per_portion.kcal} ккал: белки ${b.nutrition_per_portion.protein}, жиры ${b.nutrition_per_portion.fat}, углеводы ${b.nutrition_per_portion.carbs} грамм.`, emotion: 'спокойно' }
        : { text: 'Для этого рецепта калорийность не посчитана — в источнике нет граммовок.', emotion: 'грусть' }
    if (/температур|сколько градус|на скольки градус/.test(s) && s.split(' ').length < 9) return { text: cur.temp_text ? `Температура: ${cur.temp_text}.` : 'Температура в рецепте отдельно не указана, смотрите шаги.', emotion: 'спокойно' }
    if (/(какой|какую) (режим|программ)/.test(s)) return { text: b.modes.length ? `Режим: ${b.modes.join(', ')}.` : 'Режим в рецепте не указан.', emotion: 'спокойно' }
    if (/(сколько|долго) (готовить|по времени|времени|минут)/.test(s)) return { text: cur.time_text ? `Время: ${cur.time_text}. Всего примерно ${b.total_minutes} минут.` : `Всего примерно ${b.total_minutes || '—'} минут.`, emotion: 'спокойно' }
    if (/^(какие |что за |прочитай |перечисли )?(ингредиент\S*|продукты)( нужны| нужно| для рецепта)?$/.test(s)) return { text: `Понадобится: ${b.ingredients.join('; ')}.`, emotion: 'спокойно' }
    if (/^(сколько порций|на сколько (человек|порций))/.test(s)) return { text: cur.servings ? `Примерно ${cur.servings} порции.` : 'Число порций не указано.', emotion: 'спокойно' }
    if (/^(добавь|в) избранное$|^добавь в избранное$/.test(s)) {
      await EXEC.favorites_add({})
      return { text: 'Добавил в избранное.', emotion: 'радость' }
    }
    if (/^(закончили|закончил|готово все|все готово|блюдо готово)$/.test(s)) {
      await EXEC.cooking_finish({})
      return { text: 'Отлично! Отметил блюдо приготовленным. Приятного аппетита!', emotion: 'гордость' }
    }
  }

  // --- звонки (только с подтверждением) ---
  m = s.match(/^(?:позвони|набери|звякни|вызови|позвонить|сделай звонок|соедини меня с|соедини с)\s+(?:пожалуйста\s+)?(?:мне\s+)?(?:контакту\s+)?(.+)$/)
  if (m) {
    let r = await prepareCall(m[1])
    // «позвони жене», а в контактах «Айгерим ❤️»: имя берём из памяти («мою жену зовут Айгерим»)
    if (!r.ok) {
      const alt = nameFromMemory(m[1])
      if (alt) {
        const r2 = await prepareCall(alt)
        if (r2.ok) r = r2
      }
    }
    return { text: r.text, emotion: r.ok ? 'спокойно' : 'грусть' }
  }
  if (/^(покажи |открой |прочитай )?(мои |список )?контакт(ы|ов)$|^сколько (у меня )?контактов/.test(s)) {
    const { list, error } = await getContacts()
    if (error) return { text: error === 'pc' ? 'Контакты доступны только в приложении Бурмалдец на телефоне.' : 'Нет доступа к контактам — разрешите его в настройках телефона.', emotion: 'грусть' }
    const top = [...list].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || (b.times || 0) - (a.times || 0)).slice(0, 5)
    return { text: `У вас ${list.length} ${plural(list.length, 'контакт', 'контакта', 'контактов')}${top.length ? ', например: ' + top.map((c) => `«${c.name}»`).join(', ') : ''}. Скажите «позвони» и имя — найду, даже если оно записано иначе.`, emotion: 'спокойно' }
  }

  // --- телефон ---
  if (/^(включи|выключи|зажги|погаси) фонар/.test(s)) {
    const on = /включи|зажги/.test(s)
    const r = (await EXEC.flashlight({ on })) as { ok?: boolean }
    return r.ok ? { text: on ? 'Фонарик включён.' : 'Фонарик выключен.', emotion: 'спокойно' } : { text: 'Фонарик доступен только в приложении на телефоне.', emotion: 'грусть' }
  }
  if (/^(сделай )?(громче|тише|потише|погромче)$|^выключи звук$/.test(s) && isAndroid) {
    await EXEC.set_volume({ direction: /громче/.test(s) ? 'up' : /выключи/.test(s) ? 'mute' : 'down' })
    return { text: 'Сделал.', emotion: 'спокойно' }
  }
  if (/^(пауза|поставь на паузу|останови музыку|выключи музыку)$/.test(s) && isAndroid) {
    await EXEC.media_control({ action: 'pause' })
    return { text: 'Пауза.', emotion: 'спокойно' }
  }
  if (/^(следующ\S* (трек|песн\S*)|переключи (трек|песню))$/.test(s) && isAndroid) {
    await EXEC.media_control({ action: 'next' })
    return { text: 'Переключил.', emotion: 'спокойно' }
  }
  m = s.match(/^(?:открой|запусти) (?:приложение )?(.+)$/)
  // только «открой ватсап» — составные просьбы («открой настройки и найди…») решает Gemini по шагам
  if (m && isAndroid && m[1].split(' ').length <= 3 && !/ и | потом | затем |найди|напиши|включи|поставь|скажи/.test(' ' + m[1] + ' ') && !/холодильник|корзин|каталог|рецепт|список|избранн|покупк/.test(m[1])) {
    const r = (await EXEC.open_app({ name: m[1] })) as { ok?: boolean; app?: string }
    if (r.ok) return { text: `Открываю ${r.app || m[1]}.`, emotion: 'спокойно' }
  }

  // --- страницы приложения ---
  const pages: [RegExp, string, string][] = [
    [/холодильник/, 'fridge', 'Открываю холодильник.'],
    [/корзин|список покупок|покупки/, 'cart', 'Открываю список покупок.'],
    [/каталог/, 'catalog', 'Открываю каталог.'],
    [/избранн|дневник/, 'favorites', 'Открываю избранное.'],
    [/меню на неделю|ассистент|планировщик/, 'planner', 'Открываю меню на неделю.'],
  ]
  if (/^(открой|покажи|перейди в|перейди на|зайди в)\s/.test(s) && s.split(' ').length <= 5)
    for (const [re, page, say] of cookMode ? pages : pages.filter(([, p]) => p === 'cart'))
      if (re.test(s)) {
        await EXEC.open_page({ page })
        return { text: say, emotion: 'спокойно' }
      }

  // --- будильник: «разбуди меня в 7», «поставь будильник на 6:30», «будильник на семь вечера» ---
  m = s.match(/^(?:разбуди(?: меня)?|поставь будильник|будильник|заведи будильник)(?: на| в)?\s+(?:завтра\s+)?(?:в\s+)?(\d{1,2}|[а-я]+)(?:[:. ](\d{2})| (\d{2})| ([а-я]+(?: [а-я]+)?))?(?:\s+(утра|вечера|дня|ночи))?$/)
  if (m && isAndroid) {
    let h = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]]
    let min = m[2] ? +m[2] : m[3] ? +m[3] : m[4] && !/^(утра|вечера|дня|ночи)$/.test(m[4]) ? numberIn(m[4]) ?? 0 : 0
    const part = m[5] || (m[4] && /^(утра|вечера|дня|ночи)$/.test(m[4]) ? m[4] : '')
    if (h != null && h >= 0 && h < 24 && min >= 0 && min < 60) {
      if ((part === 'вечера' || part === 'дня') && h < 12) h += 12
      if (part === 'ночи' && h === 12) h = 0
      const r = (await EXEC.set_alarm({ hour: h, minute: min, label: 'Бурмалдец' })) as { ok?: boolean }
      const hm = `${h}:${String(min).padStart(2, '0')}`
      return r.ok ? { text: `Будильник на ${hm} поставлен.`, emotion: 'радость' } : { text: `Не получилось поставить будильник на ${hm}.`, emotion: 'грусть' }
    }
  }

  // --- напоминание: «напомни через 20 минут выключить плиту» ---
  m = s.match(/^напомни(?:те)?(?: мне)? через (.+?(?:минут\S*|час\S*|секунд\S*))\s+(?:о том что |что |чтобы |про |об? )?(.+)$/)
  if (m) {
    const sec = parseDuration(m[1])
    if (sec) {
      const r = await setReminder(m[2], '', sec / 60)
      return r.ok ? { text: `Хорошо, напомню ${r.when}: ${m[2]}.`, emotion: 'радость' } : { text: String(r.error || 'Не получилось поставить напоминание.'), emotion: 'грусть' }
    }
  }

  // --- напоминание на время: «напомни завтра в 9 утра позвонить в банк», «напомни в 18:30 забрать посылку» ---
  m = s.match(/^напомни(?:те)?(?: мне)?(?: (сегодня|завтра|послезавтра))? в (\d{1,2})(?:[:. ](\d{2}))?(?: (утра|вечера|дня|ночи))?(?: (сегодня|завтра|послезавтра))? (?:о том что |что |чтобы |про |об? )?(.+)$/)
  if (m) {
    let h = +m[2]
    const min = m[3] ? +m[3] : 0
    const part = m[4] || ''
    const day = m[1] || m[5] || ''
    if ((part === 'вечера' || part === 'дня') && h < 12) h += 12
    if (part === 'ночи' && h === 12) h = 0
    if (h < 24 && min < 60) {
      const d = new Date()
      d.setHours(h, min, 0, 0)
      if (day === 'завтра') d.setDate(d.getDate() + 1)
      else if (day === 'послезавтра') d.setDate(d.getDate() + 2)
      else if (!day && d.getTime() < Date.now() + 30000) {
        // «в 9» без «утра/вечера», а 9 уже прошло: сначала пробуем вечер, иначе — завтра
        if (!part && h < 12 && new Date().getHours() < h + 12) d.setHours(h + 12)
        else d.setDate(d.getDate() + 1)
      }
      const pad = (n: number) => String(n).padStart(2, '0')
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      const r = await setReminder(m[6], iso, 0)
      return r.ok ? { text: `Хорошо, напомню ${r.when}: ${m[6]}.`, emotion: 'радость' } : { text: String(r.error || 'Не получилось поставить напоминание.'), emotion: 'грусть' }
    }
  }

  // --- заряд ---
  if (/^(сколько )?(заряд\S*|батаре\S*)( осталось| телефона)?$|^сколько (процентов|заряда)( осталось)?$|^какой заряд$/.test(s) && isAndroid) {
    const st = await nativeCall<{ battery_percent?: number; charging?: boolean }>('status', {}, 4000).catch(() => null)
    if (st?.battery_percent != null) return { text: `Заряд ${st.battery_percent} процентов${st.charging ? ', заряжается' : ''}.`, emotion: 'спокойно' }
  }

  // --- случайность и секундомер: мгновенно, без интернета ---
  if (/^(подбрось|подкинь|брось|кинь) монет\S*$|^орел или решка$/.test(s)) return { text: pick(['Орёл!', 'Решка!']), emotion: 'удивление' }
  m = s.match(/^(?:брось|кинь|подбрось) (?:(\S+) )?(?:кубик\S*|кост\S*)$/)
  if (m) {
    const n = Math.min(6, Math.max(1, m[1] ? numberIn(m[1]) ?? 1 : 1))
    const r = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6))
    return { text: n > 1 ? `Выпало ${r.join(', ')}. Сумма ${r.reduce((x, y) => x + y, 0)}.` : `Выпало ${r[0]}.`, emotion: 'удивление' }
  }
  m = s.match(/^(?:назови |загадай |дай )?случайное число(?: от (\S+) до (\S+))?$/)
  if (m) {
    const lo = m[1] ? numberIn(m[1]) ?? 1 : 1
    const hi = m[2] ? numberIn(m[2]) ?? 100 : 100
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
    return { text: `${a + Math.floor(Math.random() * (b - a + 1))}.`, emotion: 'спокойно' }
  }
  if (/^(засеки время|запусти секундомер|включи секундомер|секундомер|старт секундомер)$/.test(s)) {
    stopwatch = Date.now()
    return { text: 'Секундомер пошёл. Скажите «стоп секундомер».', emotion: 'спокойно' }
  }
  if (/^(стоп|останови|выключи|сколько на) секундомер\S*$|^сколько прошло( времени)?$/.test(s)) {
    if (!stopwatch) return { text: 'Секундомер не запущен.', emotion: 'спокойно' }
    const sec = Math.round((Date.now() - stopwatch) / 1000)
    if (!/сколько/.test(s)) stopwatch = 0
    return { text: sec ? `Прошло ${humanDur(sec)}.` : 'Прошло меньше секунды.', emotion: 'спокойно' }
  }

  // --- повтори (не во время готовки — там «повтори» читает шаг) ---
  if (!cooking && lastSaid && /^(повтори\S*|еще раз|что ты сказал|не расслышал\S*|что\??)$/.test(s)) return { text: lastSaid, emotion: 'спокойно' }

  // --- навыки без ИИ: погода, курсы, новости, заметки, расходы, память, напоминания, «где я» ---
  const sk = await skill(s, raw).catch(() => null)
  if (sk) return sk

  // --- разговор ---
  const nm = getName()
  if (/^(привет\S*|здравствуй\S*|добрый (день|вечер)|хай|салам\S*|сәлем)$/.test(s))
    return { text: cookMode ? pick(['Привет! Режим повара включён. Что готовим?', 'Привет! Подсказать рецепт?']) : nm ? `Привет, ${nm}! Чем помочь?` : pick(['Привет! Чем помочь?', 'Привет! Я на связи.']), emotion: 'радость' }
  if (/^(спасибо|благодарю|спс|рахмет|от души)/.test(s)) return { text: pick(['Всегда пожалуйста!', 'Рад помочь.', 'Обращайтесь!']), emotion: 'радость' }
  if (/^(пока|до свидания|отбой|спи|все спасибо|всё спасибо|свободен)$/.test(s)) return { text: pick(['До встречи! Позовите — я рядом.', 'Отдыхаю. Скажите «Бурмалдец», если понадоблюсь.']), emotion: 'спокойно' }
  if (/^(как дела|как ты|как поживаешь)/.test(s)) return { text: pick(['Отлично, всё работает как часы! А у вас как?', 'Прекрасно, спасибо! Чем займёмся?', 'Бодр и готов помогать. Как у вас?']), emotion: 'радость' }
  if (/^(кто ты|ты кто|как тебя зовут|что ты умеешь|что умеешь|что ты можешь|помощь|помоги)$/.test(s))
    return {
      text: cookMode
        ? 'Сейчас я в режиме повара: ищу рецепты для ГрандШефа, читаю их по шагам, ставлю таймеры, веду список покупок и холодильник. Скажите «выйди из режима повара», чтобы вернуться в обычный режим.'
        : 'Я Бурмалдец, ваш помощник. Отвечаю на вопросы, рассказываю погоду, новости и курсы, ставлю напоминания и будильники, звоню и пишу контактам после вашего «да», включаю музыку, управляю телефоном и создаю сценарии. А по команде «режим повара» помогу на кухне.',
      emotion: 'гордость',
    }
  if (/^(что ты (обо мне )?(помнишь|знаешь)( обо мне)?|что ты запомнил)$/.test(s)) {
    const f = memoryFacts()
    const own = f.filter((x) => !/^(Зовут|Город): /.test(x)).slice(0, 6)
    const said = [
      ...f.filter((x) => x.startsWith('Зовут: ')).map((x) => 'вас зовут ' + x.slice(7)),
      ...f.filter((x) => x.startsWith('Город: ')).map((x) => 'вы живёте в ' + inCity(x.slice(7))),
      ...(own.length ? ['вы говорили: ' + own.map((x) => `«${x}»`).join(', ')] : []),
    ]
    return { text: f.length ? 'Я помню: ' + said.join('; ') + '.' : 'Пока ничего не запомнил. Расскажите о себе — например, «запомни, что я живу в Астане».', emotion: 'спокойно' }
  }
  if (/^(который час|сколько времени|сколько сейчас времени)$/.test(s)) return { text: 'Сейчас ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '.', emotion: 'спокойно' }
  if (/^(какое )?(сегодня )?(число|какое число|какой (сегодня )?день( недели)?|какая (сегодня )?дата)( сегодня)?$/.test(s))
    return { text: 'Сегодня ' + new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + '.', emotion: 'спокойно' }
  const calc = arithmetic(s)
  if (calc) return { text: calc, emotion: 'спокойно' }
  if (/^(стоп|хватит|замолчи|тихо|молчи)$/.test(s)) return { text: '', emotion: 'спокойно' }
  return null
}

/** Когда Gemini недоступен: стараемся ответить по каталогу. */
export async function fallback(raw: string, why: string, mode: Mode = getMode()): Promise<Reply> {
  const s = norm(raw)
  const live = why !== 'offline'
  // свежие данные берём сами — для этого Gemini не нужен
  if (live && /погод|прогноз|градус|холодно|жарко|дожд|снег|зонт/.test(s) && !/духовк|аэрогрил|печ/.test(s)) {
    const city = s.match(/(?:в|во)\s+([а-яё-]{3,}(?:\s[а-яё-]{3,})?)(?:\s|$)/)?.[1]
    const w = (await weather(city && !/^(завтра|сегодня|выходные)/.test(city) ? city : undefined, 2).catch(() => null)) as Record<string, any> | null
    if (w?.ok) {
      const d = /завтра/.test(s) ? w.days[1] : null
      return d
        ? { text: `Завтра ${d.sky}, от ${d.min_c} до ${d.max_c} градусов${d.rain_chance > 30 ? `, вероятность осадков ${d.rain_chance} процентов` : ''}.`, emotion: 'спокойно' }
        : { text: `Сейчас ${w.now.temp_c} градусов, ${w.now.sky}, ощущается как ${w.now.feels_like_c}. Сегодня от ${w.days[0].min_c} до ${w.days[0].max_c}.`, emotion: 'спокойно' }
    }
    if (w?.need_city) return { text: 'В каком вы городе? Скажите, например: «запомни, что я живу в Астане».', emotion: 'думаю' }
  }
  if (live && /курс|сколько стоит (доллар|евро|рубль|биткоин|юань)|доллар|евро|биткоин/.test(s)) {
    const from = /евро/.test(s) ? 'EUR' : /рубл/.test(s) ? 'RUB' : /биткоин|btc/.test(s) ? 'bitcoin' : /юан/.test(s) ? 'CNY' : 'USD'
    const r = (await rates(from, from === 'bitcoin' ? ['USD', 'KZT'] : ['KZT', 'RUB'], 1).catch(() => null)) as Record<string, any> | null
    if (r?.ok) {
      const NAME: Record<string, string> = { KZT: 'тенге', RUB: 'рублей', USD: 'долларов', EUR: 'евро', CNY: 'юаней' }
      const ONE: Record<string, string> = { USD: 'доллар', EUR: 'евро', RUB: 'рубль', CNY: 'юань', bitcoin: 'биткоин' }
      const parts = Object.entries(r.rates as Record<string, number | null>)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${(v as number) >= 100 ? Math.round(v as number) : (v as number).toFixed(1).replace('.', ',')} ${NAME[k] || k}`)
      return { text: `Один ${ONE[from] || from} сейчас примерно ${parts.join(', ')}.`, emotion: 'спокойно' }
    }
  }
  if (live && /кто выиграл|какой сч[её]т|результат матча|чем закончил/.test(s)) {
    const q = s.replace(/^(а |скажи |подскажи )?(кто выиграл|какой сч[её]т|результат матча|чем закончил\S*)( в| во)?\s*/, '').replace(/(последн\S*|вчерашн\S*|сегодняшн\S*|матч\S*)\s*/g, '').trim()
    const n = (await news(q || 'спорт', 3).catch(() => null)) as Record<string, any> | null
    if (n?.ok) return { text: 'Вот что пишут: ' + n.items.map((x: { title: string }) => x.title).join('. ') + '.', emotion: 'спокойно' }
  }
  const who = s.match(/^(?:а\s+)?(?:кто так(?:ой|ая|ие)|что так(?:ое|ой|ая)|где находится|расскажи (?:про|о|об))\s+(.+)$/)
  if (live && who) {
    const w = (await wiki(who[1]).catch(() => null)) as Record<string, any> | null
    if (w?.ok && w.extract) {
      const two = (String(w.extract).match(/[^.!?]+[.!?]+/g) || [w.extract]).slice(0, 2).join(' ').replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim()
      return { text: two, emotion: 'спокойно' }
    }
  }
  if (live && /новост|что нового|что случилось/.test(s)) {
    const n = (await news(undefined, 3).catch(() => null)) as Record<string, any> | null
    if (n?.ok) return { text: 'Главное: ' + n.items.map((x: { title: string }) => x.title).join('. ') + '.', emotion: 'спокойно' }
  }
  if (mode !== 'cook') {
    const named = s.match(/^(?:включи|поставь|вруби|сыграй)\s+(?:песню\s+|трек\s+|альбом\s+)?(.+)$/)
    if (named && !/^(музыку|музыка|что нибудь|чего нибудь|песню|песенку|какую нибудь|что то|под )/.test(named[1])) {
      const q = named[1]
      const r = (await EXEC.play_music({ query: q, kind: 'song', title: q })) as { ok?: boolean; app?: string; error?: string; note?: string }
      return r.ok ? { text: `Включаю «${q}»${r.app ? ' в ' + r.app : ''}.`, emotion: 'радость' } : { text: `Не получилось включить «${q}». ${r.note || r.error || ''}`, emotion: 'грусть' }
    }
    if (/музык|песн|трек|плейлист/.test(s)) {
      const h = new Date().getHours()
      const q = h < 11 ? 'утренний бодрый плейлист' : h < 18 ? 'хиты дня' : h < 23 ? 'вечерний chill' : 'спокойная музыка для сна'
      const r = (await EXEC.play_music({ query: q, kind: 'mood' })) as { ok?: boolean; app?: string; error?: string; note?: string }
      return r.ok ? { text: `Включаю «${q}»${r.app ? ' в ' + r.app : ''}.`, emotion: 'радость' } : { text: `Не получилось включить музыку. ${r.note || r.error || ''}`, emotion: 'грусть' }
    }
    return {
      text:
        why === 'offline'
          ? 'Сейчас нет интернета. Без него я умею немного: время, таймеры, фонарик, громкость, звонки, счёт и список покупок.'
          : why === 'limit'
            ? 'Дневной лимит умного режима исчерпан. До завтра я понимаю простые команды: погода, курсы, новости, таймеры, будильник, звонки, музыка.'
            : why === 'slow' || why === 'busy'
              ? 'Сервер думает слишком долго, не успел ответить. Повторите, пожалуйста, через пару секунд.'
              : 'Не совсем понял. Скажите иначе, пожалуйста.',
      emotion: 'грусть',
    }
  }
  const named = s.match(/^(?:включи|поставь|вруби|сыграй)\s+(?:песню\s+|трек\s+|альбом\s+)?(.+)$/)
  if (named && !/^(музыку|музыка|что нибудь|чего нибудь|песню|песенку|какую нибудь|что то|под )/.test(named[1])) {
    // назвали конкретную песню — включаем ровно её, ничего не подбираем
    const q = named[1]
    const r = (await EXEC.play_music({ query: q, kind: 'song', title: q })) as { ok?: boolean; app?: string; error?: string; note?: string }
    return r.ok ? { text: `Включаю «${q}»${r.app ? ' в ' + r.app : ''}.`, emotion: 'радость' } : { text: `Не получилось включить «${q}». ${r.note || r.error || ''}`, emotion: 'грусть' }
  }
  if (/музык|песн|трек|плейлист/.test(s)) {
    const title = session().recipe?.title.toLowerCase() || s
    const q = CUISINE_MUSIC.find(([re]) => re.test(title))?.[1] || 'cooking jazz playlist'
    const r = (await EXEC.play_music({ query: q })) as { ok?: boolean; app?: string; error?: string; note?: string; installed?: string[] }
    return r.ok
      ? { text: `Включаю «${q}»${r.app ? ' в ' + r.app : ''}.`, emotion: 'радость' }
      : { text: `Не получилось включить музыку. ${r.note || r.error || ''}`, emotion: 'грусть' }
  }
  if (/что (мне )?приготовить из (того что есть|холодильника|продуктов)|из того что (есть|в холодильнике)/.test(s)) {
    const r = (await EXEC.recipes_from_fridge({})) as { error?: string; recipes?: ReturnType<typeof short>[] }
    if (r.error || !r.recipes?.length) return { text: 'Сначала скажите, что есть в холодильнике: например, «у меня есть курица и картошка».', emotion: 'думаю' }
    lastFound = r.recipes.map((x) => ({ id: x.id, title: x.title }))
    return { text: `Из того, что есть, можно: ${listTitles(lastFound)}. Скажите «готовим первый».`, emotion: 'радость' }
  }
  if (/читай|прочитай|как (готовить|делать|приготовить)|начинаем|начнем/.test(s) && session().recipe) return readStep()
  // любой другой вопрос — ищем рецепт по словам
  const q = s
    .replace(/^((?:бурмалд\S*|бур молодец|бор молодец|чекун\S*|чеку нет|чеку конец|шеф)\s+)?(найди|покажи|предложи|подскажи|посоветуй|хочу|давай|дай|какой-нибудь|что-нибудь|рецепт\S*|мне|пожалуйста|приготовить|что|можно|на|из|с)\s+/g, '')
    .replace(/(?<![а-яёa-z0-9])(рецепт\S*|блюдо|что-нибудь|какой-нибудь|пожалуйста|приготовить)(?![а-яёa-z0-9])/g, '')
    .trim()
  const max = /быстр/.test(s) ? 30 : undefined
  const cat = /завтрак/.test(s) ? 'Завтраки' : /десерт|сладк/.test(s) ? 'Десерты' : /суп/.test(s) ? 'Супы' : undefined
  const found = await findRecipes({ query: q.replace(/(?<![а-яёa-z0-9])(быстр\S*|на ужин|на обед|на завтрак|ужин|обед|завтрак)(?![а-яёa-z0-9])/g, '').trim(), max_minutes: max, category: cat })
  if (found.length) {
    lastFound = found.slice(0, 3).map((i) => ({ id: i.id, title: i.t }))
    return { text: `${why === 'offline' ? 'Я сейчас без интернета, но кое-что нашёл. ' : ''}${listTitles(lastFound)}. Скажите «готовим первый» или «второй».`, emotion: 'радость' }
  }
  return {
    text: why === 'offline' ? 'Без интернета я понимаю только кухонные команды: рецепты, шаги, таймеры, корзину и холодильник. Этот вопрос запишу и разберусь.' : why === 'limit' ? 'Дневной лимит умного режима исчерпан — до завтра я понимаю кухонные команды: рецепты, шаги, таймеры, корзину и холодильник.' : why === 'slow' || why === 'busy' ? 'Сервер ИИ сейчас тормозит, не успел додумать. Повторите, пожалуйста, через пару секунд.' : 'Не совсем понял. Скажите иначе, например: «найди курицу на ужин» или «добавь сметану в корзину».',
    emotion: 'грусть',
  }
}

export const rememberFound = (list: { id: string; title: string }[]) => (lastFound = list)
export { fullRecipe, sameFood }
