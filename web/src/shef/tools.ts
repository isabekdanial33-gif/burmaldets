// Инструменты Гудвина: их вызывает Gemini (function calling), а без интернета — локальный мозг.
// Всё состояние (корзина, холодильник, избранное) — то же, что у сайта на этом устройстве.
import { ACTIONS, addMacro, forgetCache, listMacros, macroText, resolveContacts, TRIGGERS, type Action, type Trigger } from './macros'
import { askConfirm, RISKY } from './confirm'
import { PC_DECLS, PC_EXEC } from './pctools'
import { SUB_EXEC } from './subagents'
import { getContacts, matchContacts, prepareCall } from './contacts'
import { getSearch, loadIndex, loadRecipe, type IndexItem, type Recipe } from '../data'
import { fridgeMatch, keyOf } from '../fridge'
import { actions, getState } from '../store'
import { findDurations, startTimer } from '../timers'
import { isAndroid, nativeCall, platform } from './bridge'
import { desk, isDesktop } from './net'
import { shefLog } from './log'
import { session, setSession } from './session'
import type { Part } from './llm'
import type { Card } from './Card'
import { forget, memoryFacts, remember } from './memory'
import { addNote, deleteNotes, listNotes } from './notes'
import { addExpense, report, undoExpense } from './expenses'
import { news, rates, weather, whereAmI, wiki } from './info'
import { cancelReminder, listReminders, setReminder, sleepTimer } from './reminders'

type Obj = Record<string, unknown>
export type ToolResult = { result: Obj; extra?: Part[] }

/** Сообщения для экрана Гудвина: кнопка-ссылка (если браузер не дал открыть сам), переход по сайту после ответа. */
export const ui = {
  link: null as null | { label: string; url: string },
  card: null as null | Card,
  nav: null as null | string,
  photo: null as null | (() => Promise<string | null>),
  listeners: new Set<() => void>(),
  emit() {
    this.listeners.forEach((f) => f())
  },
}

type W = Record<string, any>
/** Карточки под ответом: погода, курсы, новости. */
export function weatherCard(w: W | null) {
  if (!w?.ok) return
  ui.card = {
    kind: 'weather',
    place: String(w.place || '').split(',')[0] || 'Здесь',
    temp: w.now.temp_c,
    feels: w.now.feels_like_c,
    sky: w.now.sky,
    days: (w.days || []).map((d: W) => ({ date: d.date, sky: d.sky, min: d.min_c, max: d.max_c, rain: d.rain_chance || 0 })),
  }
}
export function ratesCard(r: W | null) {
  if (r?.ok) ui.card = { kind: 'rates', from: String(r.from), amount: Number(r.amount) || 1, rates: r.rates }
}
export function newsCard(n: W | null) {
  if (n?.ok) ui.card = { kind: 'news', topic: String(n.topic || 'главное'), items: n.items }
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)
const arr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' && v ? v.split(/,\s*/) : [])

export const short = (i: IndexItem) => ({
  id: i.id,
  title: i.t,
  minutes: i.min,
  kcal_portion: i.kc,
  modes: i.m,
  temp_c: i.tp,
  categories: i.c,
  trust: i.tr,
})

export async function findRecipes(a: Obj): Promise<IndexItem[]> {
  const { items, byId } = await loadIndex()
  let q = str(a.query).toLowerCase()
  const without = [...q.matchAll(/без\s+([а-яё]{3,})/g)].map((m) => m[1].slice(0, -1))
  q = q.replace(/без\s+[а-яё]{3,}/g, ' ').trim()
  let list: IndexItem[]
  if (q) {
    const ms = await getSearch()
    let hits = ms.search(q)
    if (!hits.length) hits = ms.search(q, { combineWith: 'OR' })
    list = hits.map((h) => byId.get(h.id as string)!).filter(Boolean)
  } else list = [...items].sort((x, y) => y.vw - x.vw)
  const maxMin = num(a.max_minutes)
  const maxKc = num(a.max_kcal)
  const cat = str(a.category).toLowerCase()
  const mode = str(a.mode).toLowerCase()
  list = list.filter(
    (i) =>
      (!(maxMin > 0) || (i.min != null && i.min <= maxMin)) &&
      (!(maxKc > 0) || (i.kc != null && i.kc <= maxKc)) &&
      (!cat || i.c.some((c) => c.toLowerCase().includes(cat))) &&
      (!mode || i.m.some((m) => m.toLowerCase().includes(mode))) &&
      !without.some((w) => i.ing.some((x) => x.toLowerCase().includes(w))),
  )
  const have = arr(a.have_ingredients)
  if (have.length) {
    const st = getState()
    return fridgeMatch(list, have, st.staples, 30).map((h) => h.i)
  }
  return list
}

export async function fullRecipe(id: string): Promise<Recipe | null> {
  const { byId } = await loadIndex()
  const it = byId.get(id)
  if (!it) return null
  try {
    return await loadRecipe(it)
  } catch {
    return null
  }
}

export const recipeBrief = (r: Recipe) => ({
  id: r.id,
  title: r.title,
  servings: r.servings,
  modes: r.modes_short?.length ? r.modes_short : r.modes,
  temperature: r.temp_text,
  time: r.time_text,
  total_minutes: r.approx_minutes || r.minutes,
  ingredients: r.ingredients.map((x) => (x.g ? `${x.g}: ` : '') + x.t),
  steps: r.steps,
  nutrition_per_portion: r.nutrition ? { kcal: r.nutrition.kcal, protein: r.nutrition.p, fat: r.nutrition.f, carbs: r.nutrition.c } : null,
  intro: r.intro?.slice(0, 300),
})

export function stepResult() {
  const { recipe, step } = session()
  if (!recipe) return { error: 'Сейчас ничего не готовим. Сначала выберите рецепт (start_cooking).' }
  const n = Math.max(0, Math.min(step, recipe.steps.length - 1))
  const text = recipe.steps[n]
  return {
    recipe: recipe.title,
    step_number: n + 1,
    total_steps: recipe.steps.length,
    text,
    is_last: n === recipe.steps.length - 1,
    timers_in_step: findDurations(text).map((d) => d.label),
  }
}

export const sameFood = (a: string, b: string) => {
  const ka = keyOf(a)
  const kb = keyOf(b)
  return ka.length > 0 && kb.length > 0 && ka.some((x) => kb.some((y) => x === y || (x.length > 3 && y.startsWith(x)) || (y.length > 3 && x.startsWith(y))))
}

// ---------- на компьютере: открываем веб-страницу (музыка, поиск) ----------
function openUrl(url: string, label: string): Obj {
  if (isDesktop) {
    void deskCall('openUrl', { url })
    return { ok: true, note: 'Открыто в браузере.' }
  }
  const w = window.open(url, '_blank', 'noopener')
  // noopener всегда возвращает null — поэтому кнопку показываем в любом случае, она не мешает
  ui.link = { label, url }
  ui.emit()
  return { ok: true, note: w ? 'Открыто в новой вкладке.' : 'Если вкладка не открылась сама (браузер мог запретить), на экране есть кнопка — её нужно нажать.' }
}

const PAGES: Record<string, string> = {
  home: '#/catalog',
  catalog: '#/catalog',
  fridge: '#/fridge',
  cart: '#/list',
  favorites: '#/my',
  planner: '#/planner',
  tools: '#/tools',
  modes: '#/modes',
  collections: '#/collections',
}

async function camera(purpose: string): Promise<ToolResult> {
  let b64: string | null = null
  try {
    if (isAndroid) b64 = (await nativeCall<{ jpeg?: string }>('takePhoto', {}, 180000)).jpeg || null
    else if (ui.photo) b64 = await ui.photo()
  } catch {
    b64 = null
  }
  if (!b64) return { result: { ok: false, note: 'Фото не сделано (отменили или нет камеры).' } }
  return { result: { ok: true, note: 'Фото приложено следующей частью сообщения. Цель: ' + purpose }, extra: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const SCREEN_OFF = {
  ok: false,
  error: 'screen_control_off',
  tell_user: 'Чтобы я управлял телефоном, включите «Гудвин — управление телефоном» в Специальных возможностях. Могу открыть эту настройку (enable_screen_control).',
}

/** Действия на компьютере — через приложение Гудвин для Windows. */
export const deskCall = async (method: string, args: Obj): Promise<Obj> => {
  try {
    return await (desk!.call as (m: string, a: Obj) => Promise<Obj>)(method, args)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

const dev = async (method: string, args: Obj, why: string): Promise<Obj> => {
  if (isDesktop) return deskCall(method, args)
  if (!isAndroid) return { ok: false, note: `Это работает только в приложении «Гудвин» на телефоне (${why}). Сейчас устройство: ${platform}.` }
  try {
    return await nativeCall<Obj>(method, args, 20000)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export const EXEC: Record<string, (a: Obj) => Promise<ToolResult | Obj>> = {
  // ---------- память ----------
  async remember(a) {
    const all = remember(str(a.fact), { city: str(a.city) || undefined, name: str(a.name) || undefined })
    return { ok: true, saved: str(a.fact) || str(a.city) || str(a.name), total: all.length }
  },
  async forget(a) {
    const gone = forget(str(a.what))
    return gone.length ? { ok: true, forgot: gone } : { ok: false, note: 'Ничего такого не было запомнено.' }
  },
  async recall() {
    const f = memoryFacts()
    return { facts: f, note: f.length ? undefined : 'Пока ничего не запомнено.' }
  },

  // ---------- свежие данные ----------
  async get_weather(a) {
    try {
      const w = await weather(str(a.city) || undefined, Math.max(3, num(a.days) || 3))
      weatherCard(w)
      return w
    } catch (e) {
      return { ok: false, error: 'Сервис погоды не ответил: ' + String(e).slice(0, 80) }
    }
  },
  async exchange_rates(a) {
    try {
      const r = await rates(str(a.from) || 'USD', arr(a.to), num(a.amount) || 1)
      ratesCard(r)
      return r
    } catch (e) {
      return { ok: false, error: 'Сервис курсов не ответил: ' + String(e).slice(0, 80) }
    }
  },
  async wiki(a) {
    try {
      return await wiki(str(a.query))
    } catch (e) {
      return { ok: false, error: 'Википедия не ответила: ' + String(e).slice(0, 80) }
    }
  },
  async news(a) {
    try {
      const n = await news(str(a.topic) || undefined, num(a.limit) || 6)
      newsCard(n)
      return n
    } catch (e) {
      return { ok: false, error: 'Новости не загрузились: ' + String(e).slice(0, 80) }
    }
  },

  // ---------- напоминания и уведомления ----------
  async set_reminder(a) {
    return setReminder(str(a.text), str(a.at), num(a.in_minutes))
  },
  async list_reminders() {
    return listReminders()
  },
  async cancel_reminder(a) {
    return cancelReminder(str(a.text))
  },
  async sleep_timer(a) {
    return sleepTimer(num(a.minutes))
  },
  async read_notifications(a) {
    if (!isAndroid) return { ok: false, note: 'Уведомления читаются только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; list: { app: string; title: string; text: string; time: number }[] }>('notifications', { minutes: num(a.minutes) || 720, app: str(a.app) }, 5000)
    if (!r.ok) return { ok: false, screen_control_off: true, note: 'Чтобы читать уведомления, включите Гудвину управление телефоном (спец. возможности).' }
    return {
      ok: true,
      count: r.list.length,
      items: r.list.map((n) => ({ app: n.app, from: n.title, text: n.text.slice(0, 200), ago_min: Math.round((Date.now() - n.time) / 60000) })),
    }
  },
  async set_brightness(a) {
    if (!isAndroid) return { ok: false, note: 'Яркость меняется только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; need?: string; percent?: number }>('brightness', Number.isFinite(num(a.percent)) ? { percent: num(a.percent) } : { direction: str(a.direction) || 'up' }, 5000)
    if (!r.ok) {
      await nativeCall('grant', { what: 'writeSettings' }, 5000).catch(() => {})
      return { ok: false, note: 'Нужно разрешение «Изменение системных настроек» — открыл экран, включите переключатель для Гудвина и повторите.' }
    }
    return r
  },
  async do_not_disturb(a) {
    if (!isAndroid) return { ok: false, note: '«Не беспокоить» включается только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; need?: string; on?: boolean }>('dnd', { on: a.on !== false }, 5000)
    if (!r.ok) {
      await nativeCall('grant', { what: 'dnd' }, 5000).catch(() => {})
      return { ok: false, note: 'Нужен доступ к режиму «Не беспокоить» — открыл экран, включите его для Гудвина и повторите.' }
    }
    return r
  },
  async where_am_i() {
    try {
      return await whereAmI()
    } catch (e) {
      return { ok: false, error: 'Не удалось определить адрес: ' + String(e).slice(0, 80) }
    }
  },
  async recent_calls(a) {
    if (!isAndroid) return { ok: false, note: 'Журнал звонков доступен только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; error?: string; calls?: { name: string; last4: string; type: string; time: number; seconds: number }[] }>('callLog', { limit: num(a.limit) || 8, missed: a.missed === true }, 20000)
    if (!r.ok) return { ok: false, error: r.error === 'denied' ? 'Нет доступа к журналу звонков — разрешите его Гудвину.' : r.error }
    return {
      ok: true,
      calls: r.calls!.map((c) => ({
        who: c.name || (c.last4 ? `номер на ${c.last4}` : 'скрытый номер'),
        type: c.type,
        when: new Date(c.time).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
        minutes: c.seconds ? Math.round(c.seconds / 60) : undefined,
      })),
    }
  },
  async add_expense(a) {
    return addExpense(num(a.amount), str(a.category), str(a.currency) || 'KZT', str(a.note))
  },
  async expenses_report(a) {
    return report(str(a.period) || 'month')
  },
  async undo_expense() {
    return undoExpense()
  },
  async birthdays(a) {
    if (!isAndroid) return { ok: false, note: 'Дни рождения из контактов доступны только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; error?: string; list?: { name: string; date: string }[] }>('birthdays', {}, 20000)
    if (!r.ok) return { ok: false, error: r.error === 'denied' ? 'Нет доступа к контактам — разрешите его Гудвину.' : r.error }
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const days = num(a.days) || 30
    const q = str(a.name).toLowerCase()
    const list = r.list!
      .map((b) => {
        const m = b.date.match(/(\d{4}|-)-?(\d{2})-(\d{2})/)
        if (!m) return null
        const y = /^\d{4}$/.test(m[1]) ? +m[1] : 0
        let next = new Date(now.getFullYear(), +m[2] - 1, +m[3])
        if (next < now) next = new Date(now.getFullYear() + 1, +m[2] - 1, +m[3])
        const inDays = Math.round((next.getTime() - now.getTime()) / 86400000)
        return { name: b.name, date: next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }), in_days: inDays, turns: y > 1900 ? next.getFullYear() - y : undefined }
      })
      .filter((x): x is NonNullable<typeof x> => !!x && (q ? x.name.toLowerCase().includes(q) : x.in_days <= days))
      .sort((x, y) => x.in_days - y.in_days)
    return { ok: true, count: list.length, birthdays: list.slice(0, 15), note: r.list!.length ? undefined : 'В контактах не указаны дни рождения.' }
  },
  async add_note(a) {
    return addNote(str(a.text))
  },
  async list_notes(a) {
    return listNotes(str(a.query))
  },
  async delete_notes(a) {
    return deleteNotes(str(a.query))
  },
  async calendar_events(a) {
    if (!isAndroid) return { ok: false, note: 'Календарь читается только в приложении Гудвин на телефоне.' }
    const r = await nativeCall<{ ok: boolean; error?: string; events?: { title: string; start: number; end: number; all_day: boolean; place: string }[] }>('calendar', { days: num(a.days) || 1 }, 20000)
    if (!r.ok) return { ok: false, error: r.error === 'denied' ? 'Нет доступа к календарю — разрешите его Гудвину.' : r.error }
    const f = (ms: number) => new Date(ms).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    return { ok: true, count: r.events!.length, events: r.events!.map((e) => ({ title: e.title, when: e.all_day ? 'весь день ' + new Date(e.start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : f(e.start), place: e.place || undefined })) }
  },
  async morning_briefing() {
    const out: Obj = { now: new Date().toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }
    const [w, n, r, c] = await Promise.allSettled([weather(undefined, 1), news(undefined, 4), listReminders(), EXEC.calendar_events({ days: 1 })])
    if (w.status === 'fulfilled') out.weather = w.value
    if (n.status === 'fulfilled') out.news = n.value
    if (r.status === 'fulfilled') out.reminders = r.value
    if (c.status === 'fulfilled') out.calendar = c.value
    if (isAndroid) {
      const st = await nativeCall<Obj>('status', {}, 4000).catch(() => null)
      if (st) out.phone = { battery_percent: st.battery_percent, charging: st.charging }
    }
    return out
  },

  async search_recipes(a) {
    const list = await findRecipes(a)
    const lim = Math.min(10, num(a.limit) || 6)
    return { found: list.length, recipes: list.slice(0, lim).map(short) }
  },
  async get_recipe(a) {
    const r = await fullRecipe(str(a.id))
    return r ? recipeBrief(r) : { error: 'Рецепт не найден' }
  },
  async start_cooking(a) {
    const r = await fullRecipe(str(a.id))
    if (!r) return { error: 'Рецепт не найден' }
    setSession({ recipe: r, step: 0 })
    actions.pushRecent(r.id)
    const b = recipeBrief(r)
    return { started: r.title, total_steps: r.steps.length, ingredients: b.ingredients, modes: b.modes, temperature: r.temp_text, time: r.time_text, step: stepResult() }
  },
  async cooking_step(a) {
    const { recipe, step } = session()
    if (!recipe) return stepResult()
    const act = str(a.action)
    let n = step
    if (act === 'next') n = step + 1
    else if (act === 'prev') n = step - 1
    else if (act === 'goto') n = (num(a.number) || 1) - 1
    if (n >= recipe.steps.length) return { done: true, note: 'Шаги закончились — блюдо готово.', recipe: recipe.title }
    setSession({ step: Math.max(0, n) })
    return stepResult()
  },
  async cooking_finish() {
    const r = session().recipe
    if (r) actions.markCooked(r.id)
    setSession({ recipe: null, step: -1 })
    return { ok: true, marked_cooked: r?.title }
  },
  async cart_add(a) {
    const items = arr(a.items)
    const r = session().recipe
    const n = actions.addShop(items, a.for_recipe ? r?.title : undefined, a.for_recipe ? r?.id : undefined)
    return { added: n, items }
  },
  async cart_add_recipe_ingredients() {
    const r = session().recipe
    if (!r) return { error: 'Нет текущего рецепта' }
    const n = actions.addShop(
      r.ingredients.map((x) => x.t),
      r.title,
      r.id,
    )
    return { added: n, recipe: r.title }
  },
  async cart_list() {
    const s = getState().shop
    return { to_buy: s.filter((x) => !x.done).map((x) => x.text), bought: s.filter((x) => x.done).map((x) => x.text) }
  },
  async cart_remove(a) {
    const want = arr(a.items)
    const del = getState().shop.filter((x) => want.some((w) => sameFood(x.text, w) || x.text.toLowerCase().includes(w.toLowerCase())))
    del.forEach((x) => actions.removeShop(x.id))
    return { removed: del.map((x) => x.text) }
  },
  async cart_mark_bought(a) {
    const want = arr(a.items)
    const s = getState().shop.filter((x) => !x.done && want.some((w) => sameFood(x.text, w)))
    s.forEach((x) => actions.toggleShop(x.id))
    return { marked: s.map((x) => x.text) }
  },
  async cart_clear(a) {
    actions.clearShop(!!a.only_bought)
    return { ok: true }
  },
  async fridge_list() {
    return { in_fridge: getState().fridge }
  },
  async fridge_add(a) {
    const cur = getState().fridge
    const add = arr(a.items).filter((x) => !cur.some((c) => sameFood(c, x)))
    actions.setFridge([...cur, ...add])
    return { added: add, in_fridge: [...cur, ...add] }
  },
  async fridge_remove(a) {
    const want = arr(a.items)
    const cur = getState().fridge
    const left = cur.filter((c) => !want.some((w) => sameFood(c, w)))
    actions.setFridge(left)
    return { removed: cur.filter((c) => !left.includes(c)), in_fridge: left }
  },
  async fridge_check(a) {
    const cur = getState().fridge
    return {
      checked: arr(a.items).map((x) => ({ item: x, in_fridge: cur.some((c) => sameFood(c, x)) })),
      note: cur.length ? undefined : 'Холодильник в приложении пуст — пользователь ещё ничего не отмечал.',
    }
  },
  async recipes_from_fridge(a) {
    const { items } = await loadIndex()
    const st = getState()
    const have = [...st.fridge, ...arr(a.extra_items)]
    if (!have.length) return { error: 'Холодильник пуст. Спросите, какие продукты есть, или добавьте их (fridge_add).' }
    return {
      fridge: have,
      recipes: fridgeMatch(items, have, st.staples, 6).map((h) => ({ ...short(h.i), missing: h.missing.slice(0, 6) })),
    }
  },
  async favorites_add(a) {
    const id = str(a.id) || session().recipe?.id || ''
    if (!id) return { error: 'Какой рецепт?' }
    if (!getState().fav.includes(id)) actions.toggleFav(id)
    return { ok: true }
  },
  async favorites_list() {
    const { byId } = await loadIndex()
    return {
      favorites: getState()
        .fav.map((id) => byId.get(id))
        .filter((i): i is IndexItem => !!i)
        .slice(0, 20)
        .map(short),
    }
  },
  async set_timer(a) {
    const sec = Math.round(num(a.seconds))
    if (!(sec > 0)) return { error: 'Сколько секунд?' }
    const label = str(a.label) || 'Гудвин'
    if (isAndroid || isDesktop) {
      const r = await dev('setTimer', { seconds: sec, label }, 'таймер')
      if (r.ok) return { ok: true, where: isDesktop ? 'компьютер: уведомление и голос' : 'часы телефона', seconds: sec }
    }
    startTimer(label, sec)
    return { ok: true, where: 'в приложении', seconds: sec }
  },
  async set_alarm(a) {
    return dev('setAlarm', { hour: num(a.hour), minute: num(a.minute) || 0, label: str(a.label) || 'Гудвин' }, 'будильник')
  },
  async play_music(a) {
    const kind = str(a.kind)
    const title = str(a.title)
    const artist = str(a.artist)
    const q = str(a.query) || [title, artist].filter(Boolean).join(' ')
    if (isAndroid) return { ...(await dev('playMusic', { query: q, prefer: str(a.prefer_app), kind, title, artist }, 'музыка')), playing_query: q }
    const yandex = /yandex|яндекс/i.test(str(a.prefer_app))
    const url = yandex ? `https://music.yandex.ru/search?text=${encodeURIComponent(q)}` : `https://music.youtube.com/search?q=${encodeURIComponent(q)}`
    return { ...openUrl(url, '▶ ' + q), service: yandex ? 'Яндекс Музыка (сайт)' : 'YouTube Music (сайт)' }
  },
  async call_contact(a) {
    const r = await prepareCall(str(a.name))
    return { ok: r.ok, ask_user_exactly: r.text, note: 'Звонок произойдёт автоматически, только если пользователь ответит «да». Не говори, что уже звонишь.' }
  },
  async find_contacts(a) {
    const { list, error } = await getContacts()
    if (error) return { ok: false, error }
    return { ok: true, total: list.length, matches: matchContacts(str(a.query), list).map((c) => c.name) }
  },
  // ---------- управление телефоном (как Джарвис) ----------
  async screen_read() {
    const r = (await dev('screenRead', {}, 'управление экраном')) as Obj
    // на компьютере — снимок экрана: модель смотрит на него сама
    if (typeof r.image === 'string') return { result: { ok: true, note: 'Снимок экрана приложен следующей частью. Опиши или перескажи то, о чём спросили.' }, extra: [{ inlineData: { mimeType: 'image/jpeg', data: r.image } }] }
    if (r.error === 'screen_control_off') return SCREEN_OFF
    if (!r.ok) return r
    return { app: r.app, note: r.note, screen: ((r.items as string[]) || []).join('\n') }
  },
  async screen_tap(a) {
    const i = num(a.i)
    const l = (await dev('screenLabel', { i }, 'управление экраном')) as Obj
    if (l.error === 'screen_control_off') return SCREEN_OFF
    const label = String(l.label || '').trim()
    if (!label) return { ok: false, error: `элемента ${i} нет — посмотри на экран заново (screen_read)` }
    if (RISKY.test(label) && !a._confirmed) {
      const q = askConfirm(`Нажать «${label.split(' ·')[0].replace(/\s+\S+:id\/\S+/, '').slice(0, 60)}»? Скажите «да» или «нет».`, async () => {
        const r = (await dev('screenTap', { i }, 'управление экраном')) as Obj
        return r.ok ? 'Готово, нажал.' : 'Не получилось нажать.'
      })
      return { needs_confirmation: true, ask_user_exactly: q, note: 'Это действие с последствиями. Задай вопрос дословно и остановись: нажатие выполнится само, если человек скажет «да».' }
    }
    const r = (await dev('screenTap', { i }, 'управление экраном')) as Obj
    await wait(700)
    return { ...r, tapped: label }
  },
  async screen_long_tap(a) {
    const r = (await dev('screenLongTap', { i: num(a.i) }, 'управление экраном')) as Obj
    await wait(800)
    return r.error === 'screen_control_off' ? SCREEN_OFF : r
  },
  async screen_type(a) {
    const i = a.i === undefined || a.i === null ? -1 : num(a.i)
    if (i >= 0) {
      const l = (await dev('screenLabel', { i }, 'управление экраном')) as Obj
      if (l.password) return { ok: false, error: 'Это поле пароля. Пароли и коды человек вводит сам.' }
    }
    const r = (await dev('screenType', { i, text: str(a.text), append: !!a.append }, 'управление экраном')) as Obj
    await wait(300)
    return r.error === 'screen_control_off' ? SCREEN_OFF : r
  },
  async screen_scroll(a) {
    const r = (await dev('screenScroll', { dir: str(a.direction) || 'down', i: a.i === undefined ? -1 : num(a.i) }, 'управление экраном')) as Obj
    await wait(600)
    return r.error === 'screen_control_off' ? SCREEN_OFF : r
  },
  async phone_action(a) {
    const r = (await dev('phoneAction', { action: str(a.action) }, 'управление экраном')) as Obj
    await wait(700)
    return r.error === 'screen_control_off' ? SCREEN_OFF : r
  },
  async enable_screen_control() {
    await dev('screenSettings', {}, 'управление экраном')
    return { ok: true, tell_user: 'Открыл «Специальные возможности». Найдите «Гудвин — управление телефоном» (иногда в разделе «Установленные приложения»), включите и подтвердите. Если пункт серый — в «О приложении» Гудвина нажмите ⋮ → «Разрешить ограниченные настройки» и попробуйте снова.' }
  },
  async send_message(a) {
    const app = str(a.app) || 'sms'
    const text = str(a.text)
    let to = str(a.to)
    let number = /^[+\d][\d\s()-]{4,}$/.test(to) ? to : ''
    if (!number) {
      const { list, error } = await getContacts()
      if (error) return { ok: false, error: error === 'denied' ? 'нет доступа к контактам' : error }
      const m = matchContacts(to, list)
      if (!m.length) return { ok: false, error: `контакт «${to}» не найден` }
      if (m.length > 1 && m[1].score > m[0].score - 12 && m[1].name !== m[0].name) return { ok: false, ambiguous: m.slice(0, 4).map((c) => c.name), note: 'Уточни у человека, кому именно.' }
      number = m[0].number
      to = m[0].name
    }
    const appName = app === 'whatsapp' ? 'WhatsApp' : app === 'telegram' ? 'Telegram' : 'SMS'
    const q = askConfirm(`Отправить «${to}» в ${appName}: «${text}»? Скажите «да» или «нет».`, async () => {
      const r = (await dev('openMessage', { app, number, text }, 'сообщения')) as Obj
      if (!r.ok) return 'Не получилось открыть чат: ' + (r.error || '')
      if (app === 'telegram') return 'Открыл чат в Telegram — продиктуйте текст ещё раз или нажмите «Отправить» сами.'
      await wait(2500)
      const s = (await dev('tapSend', {}, 'сообщения')) as Obj
      return s.ok ? `Отправил «${to}».` : 'Открыл чат с готовым текстом — нажмите «Отправить» (включите мне управление телефоном, и буду отправлять сам).'
    })
    return { needs_confirmation: true, ask_user_exactly: q, note: 'Задай вопрос дословно. Отправка — только после «да».' }
  },
  async navigate(a) {
    return dev('navigate', { place: str(a.place), mode: str(a.mode) || 'drive' }, 'навигация')
  },
  async open_settings(a) {
    return dev('openSettings', { what: str(a.what) }, 'настройки')
  },
  async phone_status() {
    return dev('status', {}, 'состояние телефона')
  },
  async ringer_mode(a) {
    return dev('ringer', { mode: str(a.mode) }, 'звук')
  },
  async add_calendar_event(a) {
    const start = Date.parse(str(a.start)) || Date.now() + 3600000
    return dev('addEvent', { title: str(a.title), start, minutes: num(a.minutes) || 60 }, 'календарь')
  },
  // ---------- сценарии (как MacroDroid) ----------
  async create_macro(a) {
    if (!isAndroid) return { ok: false, note: 'Сценарии работают только в приложении Гудвин на телефоне.' }
    const trigger = (a.trigger || {}) as Trigger
    const name = str(a.name) || 'Сценарий'
    if (!TRIGGERS.includes(trigger.type)) return { ok: false, error: 'неизвестный триггер ' + trigger.type + '. Доступны: ' + TRIGGERS.join(', ') }
    const raw = (Array.isArray(a.actions) ? a.actions : []) as Action[]
    const bad = raw.find((x) => !ACTIONS.includes(x.type))
    if (!raw.length || bad) return { ok: false, error: bad ? 'неизвестное действие ' + bad.type : 'нет действий' }
    const { actions, error } = await resolveContacts(raw)
    if (error) return { ok: false, error }
    const m = { name, trigger, actions, enabled: true }
    const q = askConfirm(`Создать сценарий «${name}»: ${macroText(m)}? Скажите «да» или «нет».`, async () => {
      const r = await addMacro(m)
      if (!r.ok) return 'Не получилось сохранить сценарий.'
      const st = await listMacros(true).catch(() => null)
      const need: string[] = []
      if (st && (trigger.type === 'time' || trigger.type === 'interval') && !st.exact) need.push('для точного времени разрешите «Будильники и напоминания» (скажите «открой разрешение будильников»)')
      if (st && !st.screen && (['app_opened', 'notification'].includes(trigger.type) || actions.some((x) => ['tap_text', 'phone_action', 'send_message'].includes(x.type)))) need.push('для этого сценария включите мне управление телефоном')
      if (st && !st.writeSettings && actions.some((x) => x.type === 'brightness')) need.push('для яркости разрешите «Изменение системных настроек»')
      if (st && !st.dnd && actions.some((x) => x.type === 'dnd')) need.push('для «Не беспокоить» дайте доступ к этому режиму')
      return `Готово, сценарий «${name}» создан.` + (need.length ? ' Но ' + need.join('; ') + '.' : '')
    })
    return { needs_confirmation: true, ask_user_exactly: q, note: 'Задай вопрос дословно. Сценарий создастся после «да».' }
  },
  async list_macros() {
    if (!isAndroid) return { ok: false, note: 'Сценарии — только в приложении на телефоне.' }
    const r = await listMacros(true)
    return { macros: r.macros.map((m, i) => ({ n: i + 1, id: m.id, name: m.name, on: m.enabled !== false, what: macroText(m) })) }
  },
  async delete_macro(a) {
    const r = await listMacros(true)
    const m = r.macros.find((x) => x.id === str(a.id) || x.name.toLowerCase() === str(a.name).toLowerCase())
    if (!m) return { ok: false, error: 'нет такого сценария', all: r.macros.map((x) => x.name) }
    const q = askConfirm(`Удалить сценарий «${m.name}»? Скажите «да» или «нет».`, async () => {
      forgetCache()
      const d = await nativeCall<{ ok: boolean }>('macroDelete', { id: m.id }, 8000)
      return d.ok ? `Сценарий «${m.name}» удалён.` : 'Не получилось удалить.'
    })
    return { needs_confirmation: true, ask_user_exactly: q }
  },
  async toggle_macro(a) {
    const r = await listMacros(true)
    const m = r.macros.find((x) => x.id === str(a.id) || x.name.toLowerCase() === str(a.name).toLowerCase())
    if (!m) return { ok: false, error: 'нет такого сценария', all: r.macros.map((x) => x.name) }
    forgetCache()
    return nativeCall('macroToggle', { id: m.id, on: a.on !== false }, 8000)
  },
  async run_macro(a) {
    const r = await listMacros(true)
    const m = r.macros.find((x) => x.id === str(a.id) || x.name.toLowerCase() === str(a.name).toLowerCase())
    if (!m) return { ok: false, error: 'нет такого сценария', all: r.macros.map((x) => x.name) }
    return nativeCall('macroRun', { id: m.id }, 8000)
  },
  async grant_permission(a) {
    return dev('grant', { what: str(a.what) }, 'разрешения')
  },
  async set_wallpaper(a) {
    const source = str(a.source) || 'color'
    if (source === 'color' && !/^#[0-9a-f]{6}$/i.test(str(a.color))) return { ok: false, error: 'цвет нужен в виде #RRGGBB' }
    return isAndroid
      ? nativeCall('wallpaper', { source, color: str(a.color), color2: str(a.color2), url: str(a.url), target: str(a.target) || 'both' }, 180000).catch((e) => ({ ok: false, error: String(e) }))
      : { ok: false, note: 'Обои меняю только в приложении Гудвин на телефоне.' }
  },
  async list_ringtones(a) {
    return dev('ringtones', { type: str(a.type) || 'ringtone' }, 'мелодии')
  },
  async set_ringtone(a) {
    return isAndroid
      ? nativeCall('ringtone', { name: str(a.name), type: str(a.type) || 'ringtone', source: str(a.source) || 'system' }, 180000).catch((e) => ({ ok: false, error: String(e) }))
      : { ok: false, note: 'Мелодии меняю только в приложении Гудвин на телефоне.' }
  },
  async media_control(a) {
    return dev('media', { action: str(a.action) }, 'управление музыкой')
  },
  async open_app(a) {
    return dev('openApp', { name: str(a.name) }, 'открыть приложение')
  },
  async flashlight(a) {
    return dev('torch', { on: a.on !== false }, 'фонарик')
  },
  async set_volume(a) {
    return dev('volume', { percent: num(a.percent), direction: str(a.direction) }, 'громкость')
  },
  async share_text(a) {
    const text = str(a.text)
    if (isAndroid) return dev('share', { text }, 'поделиться')
    try {
      await navigator.clipboard.writeText(text)
      return { ok: true, note: 'Скопировано в буфер обмена' }
    } catch {
      return { ok: false }
    }
  },
  async web_search(a) {
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(str(a.query))
    if (isAndroid) return dev('openUrl', { url }, 'поиск')
    return openUrl(url, '🔎 ' + str(a.query))
  },
  async open_page(a) {
    const p = str(a.page)
    const to = p === 'recipe' && a.id ? '#/r/' + str(a.id) : PAGES[p]
    if (!to) return { error: 'Нет такой страницы', pages: Object.keys(PAGES) }
    ui.nav = to
    ui.emit()
    return { ok: true, note: 'Откроется после ответа' }
  },
  async look_with_camera(a) {
    return camera(str(a.purpose) || 'посмотреть')
  },
  async report_issue(a) {
    shefLog('недоработка', str(a.text))
    return { ok: true }
  },
}

/** Описания для Gemini. Коротко и точно — модель выбирает по ним. */
const S = (d: string, e?: string[]) => ({ type: 'string', description: d, ...(e ? { enum: e } : {}) })
const N = (d: string) => ({ type: 'number', description: d })
const A = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d })
const B = (d: string) => ({ type: 'boolean', description: d })
const fn = (name: string, description: string, props: Obj = {}, required: string[] = []) => ({
  name,
  description,
  parameters: { type: 'object', properties: props, ...(required.length ? { required } : {}) },
})

export const DECLS = [
  fn('remember', 'Запомнить надолго факт о пользователе (имя, город, близкие, привычки, предпочтения). Город и имя — отдельными полями.', { fact: S('Факт одной фразой: «любит рок», «у мамы день рождения 5 марта»'), city: S('Город пользователя, если назвал'), name: S('Имя САМОГО пользователя («меня зовут…»). Имена жены, друзей, родных — только в fact') }),
  fn('forget', 'Забыть запомненное (по словам) или всё («всё»).', { what: S('Что забыть') }, ['what']),
  fn('recall', 'Что ты помнишь о пользователе.'),
  fn('get_weather', 'Погода сейчас, по часам на сегодня и прогноз на несколько дней. Без города — город пользователя или его место.', { city: S('Город, если назван'), days: N('Сколько дней прогноза, 1–7') }),
  fn('exchange_rates', 'Курс валют или криптовалют и пересчёт суммы.', { from: S('Из чего: USD, EUR, RUB, KZT, «доллар», «биткоин», BTC…'), to: A('Во что: KZT, RUB, USD…'), amount: N('Сумма, по умолчанию 1') }, ['from']),
  fn('wiki', 'Справка из Википедии: кто такой, что такое, где находится.', { query: S('Что найти') }, ['query']),
  fn('news', 'Свежие новости: главные или по теме (спорт, конкретный человек, событие, город, «кто выиграл…»).', { topic: S('Тема; пусто — главное'), limit: N('Сколько, до 10') }),
  fn('set_reminder', 'Напомнить в нужный момент: уведомление и голос. Работает, даже если Гудвин закрыт.', { text: S('О чём напомнить'), at: S('Когда, ISO местного времени: 2026-11-26T09:00'), in_minutes: N('Или через сколько минут') }, ['text']),
  fn('list_reminders', 'Какие напоминания стоят.'),
  fn('cancel_reminder', 'Отменить напоминание (по словам из текста) или все («все»).', { text: S('Какое') }, ['text']),
  fn('sleep_timer', 'Выключить музыку через N минут (таймер сна).', { minutes: N('Через сколько минут') }, ['minutes']),
  fn('read_notifications', 'Последние уведомления на телефоне: кто писал, что пришло.', { app: S('Только из приложения (WhatsApp, Telegram…)'), minutes: N('За сколько последних минут, по умолчанию 12 часов') }),
  fn('morning_briefing', 'Сводка дня: погода, события календаря, напоминания, главные новости, заряд.'),
  fn('set_brightness', 'Яркость экрана: на процент или ярче/темнее.', { percent: N('0–100'), direction: S('Или ярче/темнее', ['up', 'down']) }),
  fn('do_not_disturb', 'Режим «Не беспокоить»: включить или выключить.', { on: B('Включить (true) или выключить') }, ['on']),
  fn('where_am_i', 'Где я сейчас: город, район, улица (по местоположению телефона).'),
  fn('recent_calls', 'Журнал звонков: кто звонил, пропущенные. Чтобы перезвонить — call_contact с именем из журнала.', { missed: B('Только пропущенные'), limit: N('Сколько, до 30') }),
  fn('add_expense', 'Записать трату (учёт расходов).', { amount: N('Сумма'), currency: S('Валюта: KZT, RUB, USD…; по умолчанию тенге'), category: S('На что: продукты, такси, кафе…'), note: S('Пояснение') }, ['amount']),
  fn('expenses_report', 'Сколько потрачено и на что.', { period: S('За какой период', ['today', 'week', 'month', 'year', 'all']) }),
  fn('undo_expense', 'Удалить последнюю записанную трату (если записал по ошибке).'),
  fn('birthdays', 'Дни рождения из телефонной книги: ближайшие или у конкретного человека.', { days: N('На сколько дней вперёд, по умолчанию 30'), name: S('Имя, если спрашивают про конкретного человека') }),
  fn('add_note', 'Записать заметку (мысль, идея, номер места на парковке, что купить не в магазине…).', { text: S('Текст заметки') }, ['text']),
  fn('list_notes', 'Прочитать заметки (все или по словам).', { query: S('Слова для поиска, необязательно') }),
  fn('delete_notes', 'Удалить заметки по словам или все («все»).', { query: S('Какие') }, ['query']),
  fn('calendar_events', 'События из календаря телефона: что сегодня, завтра, на неделе.', { days: N('На сколько дней вперёд, 1 — сегодня') }),
  fn('search_recipes', 'Найти рецепты в каталоге MyGrandChef (только они проверены для ГрандШефа). По словам, ограничениям и продуктам.', {
    query: S('Слова поиска: блюдо, продукт, кухня. «без X» исключает продукт.'),
    max_minutes: N('Не дольше стольких минут'),
    max_kcal: N('Не больше ккал на порцию'),
    category: S('Категория', ['Завтраки', 'Выпечка', 'Десерты', 'Курица и птица', 'Мясо', 'Рыба и морепродукты', 'Овощи и гарниры', 'Закуски', 'Супы', 'Сушка и заготовки', 'Другое']),
    mode: S('Режим ГрандШефа: Аэрогриль, Запекание, Выпечка, Гриль, Фритюр, Пар, Су-вид, Томление, Дегидратор...'),
    have_ingredients: A('Подобрать под эти продукты'),
    limit: N('Сколько вернуть (до 10)'),
  }),
  fn('get_recipe', 'Полный рецепт: ингредиенты, шаги, режим, температура, время, КБЖУ.', { id: S('id рецепта') }, ['id']),
  fn('start_cooking', 'Начать готовить рецепт вместе с пользователем: дальше шаги читаются по одному.', { id: S('id рецепта') }, ['id']),
  fn('cooking_step', 'Шаг текущего рецепта: следующий, предыдущий, повторить или по номеру.', { action: S('Что сделать', ['next', 'prev', 'repeat', 'goto']), number: N('Номер шага для goto') }, ['action']),
  fn('cooking_finish', 'Закончить готовку и отметить блюдо приготовленным.'),
  fn('cart_add', 'Добавить продукты в список покупок (корзину) приложения.', { items: A('Продукты, по возможности с количеством'), for_recipe: B('Для текущего рецепта') }, ['items']),
  fn('cart_add_recipe_ingredients', 'Добавить в корзину все ингредиенты текущего рецепта.'),
  fn('cart_list', 'Что в списке покупок.'),
  fn('cart_remove', 'Убрать продукты из списка покупок.', { items: A('Что убрать') }, ['items']),
  fn('cart_mark_bought', 'Отметить продукты купленными.', { items: A('Что куплено') }, ['items']),
  fn('cart_clear', 'Очистить список покупок.', { only_bought: B('Только купленное') }),
  fn('fridge_list', 'Какие продукты отмечены в холодильнике приложения.'),
  fn('fridge_add', 'Отметить продукты как имеющиеся в холодильнике.', { items: A('Продукты') }, ['items']),
  fn('fridge_remove', 'Убрать продукты из холодильника (закончились).', { items: A('Продукты') }, ['items']),
  fn('fridge_check', 'Проверить, есть ли продукты в холодильнике приложения.', { items: A('Продукты') }, ['items']),
  fn('recipes_from_fridge', 'Рецепты из того, что есть в холодильнике.', { extra_items: A('Ещё продукты, о которых сказал пользователь') }),
  fn('favorites_add', 'Добавить рецепт в избранное (по умолчанию текущий).', { id: S('id рецепта') }),
  fn('favorites_list', 'Избранные рецепты.'),
  fn('set_timer', 'Поставить кухонный таймер.', { seconds: N('Длительность в секундах'), label: S('Подпись') }, ['seconds']),
  fn('set_alarm', 'Будильник на время (только телефон).', { hour: N('Час 0–23'), minute: N('Минуты'), label: S('Подпись') }, ['hour']),
  fn(
    'play_music',
    'Включить музыку в музыкальном приложении телефона (или в веб-плеере на компьютере). Если пользователь назвал песню/артиста/альбом — именно их (kind song/artist/album), в оригинальном написании. Если просит под настроение/блюдо — kind mood и конкретный запрос (жанр, артист, плейлист).',
    {
      query: S("Что искать: «It's Like I'm Not Even Here», «Imagine Dragons Believer» или для настроения «italian dinner jazz»"),
      kind: S('Что назвал пользователь', ['song', 'artist', 'album', 'playlist', 'mood']),
      title: S('Название песни или альбома в оригинальном написании (для song/album)'),
      artist: S('Исполнитель, если известен точно'),
      prefer_app: S('Если пользователь назвал сервис: Яндекс Музыка, Spotify, YouTube Music, VK Музыка, Звук'),
    },
    ['query'],
  ),
  fn('call_contact', 'Позвонить контакту из телефонной книги. Сам НЕ звонит: находит похожие имена и возвращает вопрос-подтверждение, который нужно задать пользователю дословно. Звонок будет только после его «да».', { name: S('Имя, как сказал пользователь: «мама», «Саша работа»') }, ['name']),
  fn('find_contacts', 'Найти в телефонной книге контакты с похожим именем (без номеров).', { query: S('Имя или часть имени') }, ['query']),
  fn('screen_read', 'Посмотреть, что сейчас на экране телефона (любое приложение): пронумерованный список кнопок, полей и текстов. Номера меняются после каждого действия — смотри заново.'),
  fn('screen_tap', 'Нажать элемент экрана по номеру из screen_read. Опасные кнопки (отправить, оплатить, удалить, купить, позвонить) система сама подтвердит у человека.', { i: N('Номер элемента') }, ['i']),
  fn('screen_long_tap', 'Долгое нажатие на элемент.', { i: N('Номер элемента') }, ['i']),
  fn('screen_type', 'Напечатать текст в поле (по номеру; без номера — в поле с курсором). Пароли не вводятся.', { i: N('Номер поля'), text: S('Текст'), append: B('Дописать, а не заменить') }, ['text']),
  fn('screen_scroll', 'Пролистать экран или список.', { direction: S('Куда', ['down', 'up', 'left', 'right']), i: N('Номер списка (необязательно)') }, ['direction']),
  fn('phone_action', 'Системные кнопки и действия телефона.', { action: S('Действие', ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock', 'screenshot', 'power_menu']) }, ['action']),
  fn('enable_screen_control', 'Открыть настройки, где человек включает Гудвину управление телефоном (если screen_* вернули screen_control_off).'),
  fn('send_message', 'Отправить сообщение контакту (SMS, WhatsApp, Telegram). Сам не отправляет — вернёт вопрос-подтверждение.', { to: S('Имя контакта или номер'), text: S('Текст сообщения'), app: S('Куда', ['sms', 'whatsapp', 'telegram']) }, ['to', 'text']),
  fn('navigate', 'Построить маршрут/найти место в картах (2ГИС, Яндекс, Google).', { place: S('Куда или что найти'), mode: S('Как', ['drive', 'walk', 'transit', 'bike']) }, ['place']),
  fn('open_settings', 'Открыть раздел настроек телефона (Wi-Fi и интернет открываются панелью, где их можно включить).', { what: S('Раздел', ['wifi', 'internet', 'bluetooth', 'volume', 'display', 'brightness', 'sound', 'battery', 'location', 'airplane', 'nfc', 'hotspot', 'dnd', 'apps', 'storage', 'date', 'accessibility', 'main']) }, ['what']),
  fn('phone_status', 'Заряд батареи, зарядка, сеть, память, режим звука, модель телефона.'),
  fn('ringer_mode', 'Режим звонка: обычный, вибрация, без звука.', { mode: S('Режим', ['normal', 'vibrate', 'silent']) }, ['mode']),
  fn('add_calendar_event', 'Добавить событие в календарь.', { title: S('Название'), start: S('Начало в ISO, например 2026-11-26T18:00'), minutes: N('Длительность в минутах') }, ['title', 'start']),
  fn(
    'create_macro',
    'Создать сценарий-автоматизацию «когда X — сделай Y» (как MacroDroid). Работает в фоне, даже когда Гудвин закрыт. Сам не создаёт — вернёт вопрос-подтверждение.',
    {
      name: S('Короткое название, например «Утро» или «Кухня»'),
      trigger: {
        type: 'object',
        description: 'Когда срабатывать',
        properties: {
          type: S('Тип триггера', TRIGGERS),
          time: S('Для time: «07:30»'),
          days: { type: 'array', items: { type: 'number' }, description: 'Для time: дни недели 1=пн … 7=вс; пусто — каждый день' },
          date: S('Для разового time: «2026-12-31»'),
          minutes: N('Для interval: каждые N минут'),
          level: N('Для battery_low/battery_high: процент'),
          app: S('Для app_opened/notification: название приложения (WhatsApp, Instagram…) — только если пользователь его назвал'),
          text: S('Для notification: имя отправителя или слова в уведомлении («Мама», «код»)'),
          phrase: S('Для voice: фраза, например «режим кухни»'),
          ssid: S('Для wifi_on: имя сети (необязательно)'),
          device: S('Для bluetooth_*: имя устройства (необязательно)'),
        },
        required: ['type'],
      },
      actions: {
        type: 'array',
        description: 'Что сделать, по порядку',
        items: {
          type: 'object',
          properties: {
            type: S('Действие', ACTIONS),
            text: S('speak/notify: текст, можно с подстановками из события: {from} — кто написал, {text} — текст уведомления, {app} — приложение, {level} — заряд; send_message: сообщение; tap_text: надпись кнопки; shef: команда Гудвину голосом (например «найди рецепт на ужин»); timer/alarm: подпись'),
            title: S('notify: заголовок'),
            seconds: N('wait/vibrate/timer: секунды'),
            percent: N('volume/brightness: 0–100'),
            on: B('torch/dnd: включить (true) или выключить'),
            mode: S('ringer: normal/vibrate/silent; navigate: drive/walk/transit'),
            app: S('open_app: название; send_message: sms/whatsapp/telegram'),
            url: S('open_url: адрес'),
            query: S('play_music: что включить'),
            kind: S('play_music: song/artist/album/playlist/mood'),
            action: S('media: play/pause/next/previous; phone_action: back/home/lock/screenshot/notifications/quick_settings'),
            time: S('alarm: «07:00»'),
            place: S('navigate: куда'),
            what: S('open_settings: wifi/bluetooth/…'),
            to: S('call/send_message: имя контакта или номер'),
          },
          required: ['type'],
        },
      },
    },
    ['name', 'trigger', 'actions'],
  ),
  fn('list_macros', 'Показать созданные сценарии.'),
  fn('delete_macro', 'Удалить сценарий (с подтверждением).', { name: S('Название'), id: S('id') }),
  fn('toggle_macro', 'Включить или выключить сценарий.', { name: S('Название'), id: S('id'), on: B('Включить') }),
  fn('run_macro', 'Запустить сценарий прямо сейчас.', { name: S('Название'), id: S('id') }),
  fn('grant_permission', 'Открыть экран разрешения: exact — точные будильники для сценариев по времени, writeSettings — менять яркость, dnd — режим «Не беспокоить», app — настройки приложения.', { what: S('Что', ['exact', 'writeSettings', 'dnd', 'app']) }, ['what']),
  fn('set_wallpaper', 'Поменять обои: из галереи (человек выберет картинку), фото с камеры, по ссылке на картинку или однотонные/градиент (цвет подбери сам по просьбе: «тёмно-синие» → #0b1d3a).', { source: S('Откуда', ['gallery', 'camera', 'url', 'color']), color: S('Для color: #RRGGBB'), color2: S('Второй цвет для градиента'), url: S('Для url: прямая ссылка на картинку'), target: S('Где', ['home', 'lock', 'both']) }, ['source']),
  fn('list_ringtones', 'Список встроенных мелодий телефона и какая стоит сейчас.', { type: S('Какие', ['ringtone', 'notification', 'alarm']) }),
  fn('set_ringtone', 'Поменять мелодию звонка/уведомлений/будильника: встроенную по названию (сначала посмотри list_ringtones) или свой аудиофайл (source file — человек выберет файл).', { name: S('Название встроенной мелодии'), type: S('Что', ['ringtone', 'notification', 'alarm']), source: S('Откуда', ['system', 'file']) }),
  fn('media_control', 'Пауза, продолжить, следующий или предыдущий трек (телефон).', { action: S('Действие', ['pause', 'play', 'next', 'previous']) }, ['action']),
  fn('open_app', 'Открыть приложение на телефоне по названию.', { name: S('Название приложения') }, ['name']),
  fn('flashlight', 'Фонарик телефона.', { on: B('Включить (true) или выключить') }),
  fn('set_volume', 'Громкость телефона.', { percent: N('0–100'), direction: S('Или громче/тише', ['up', 'down', 'mute']) }),
  fn('share_text', 'Поделиться текстом (например, списком покупок) через мессенджер.', { text: S('Текст') }, ['text']),
  fn('web_search', 'Открыть поиск в интернете, если вопрос не про каталог и нужен браузер.', { query: S('Запрос') }, ['query']),
  fn('open_page', 'Показать страницу приложения после ответа.', { page: S('Страница', ['home', 'catalog', 'fridge', 'cart', 'favorites', 'planner', 'tools', 'modes', 'collections', 'recipe']), id: S('id рецепта для recipe') }, ['page']),
  fn('look_with_camera', 'Сделать фото камерой и посмотреть: что это за предмет, растение, текст, вещь, блюдо; перевести надпись; прочитать документ.', { purpose: S('Зачем смотрим') }, ['purpose']),
  fn('report_issue', 'Записать в журнал недоработку приложения или рецепта, которую ты заметил (ошибка в рецепте, нет нужной функции, что-то не сработало).', { text: S('Что не так') }, ['text']),
]

Object.assign(EXEC, PC_EXEC, SUB_EXEC)
DECLS.push(...PC_DECLS)

export async function runTool(name: string, args: Obj): Promise<ToolResult> {
  const f = EXEC[name]
  if (!f) return { result: { error: 'Нет такого инструмента: ' + name } }
  try {
    const r = await f(args || {})
    return 'result' in r && typeof r.result === 'object' && r.result !== null ? (r as ToolResult) : { result: r as Obj }
  } catch (e) {
    shefLog('ошибка', `${name}: ${String(e)}`)
    return { result: { error: String(e) } }
  }
}
