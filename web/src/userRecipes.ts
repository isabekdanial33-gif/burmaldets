// Рецепты от владельцев ГрандШефа: отправка на модерацию, модерация в админке.
// Сервер: supabase/migrations/0003_user_recipes.sql (submit_recipe, admin_pending_recipes, admin_review_recipe).
// В dev без сервера всё хранится в localStorage — чтобы можно было пройти весь путь руками.
import type { IndexItem, Recipe } from './data'
import { configured, sb } from './supa'

export type Submission = {
  title: string
  intro: string
  category: string
  mode: string
  temp_c: number | null
  minutes: number | null
  servings: number | null
  ingredients: string[]
  steps: string[]
  image_url: string | null
}

export type Pending = Submission & {
  id: string
  created_at: string
  status?: 'pending' | 'approved' | 'rejected'
  author?: { name?: string; email?: string; avatar?: string } | null
}

/** Полные названия режимов — так они записаны в рецептах (короткое — до « / »). */
export const FULL_MODES = [
  'АЭРОГРИЛЬ / AIR CRISP',
  'ЗАПЕКАНИЕ / ROAST',
  'ВЫПЕЧКА / BAKE',
  'ГРИЛЬ / GRILL',
  'БАРБЕКЮ / BBQ',
  'ФРИТЮР / DEEP FRY',
  'СУ-ВИД / SOUS VIDE',
  'ПАР / STEAM',
  'ТОМЛЕНИЕ / SLOW COOK',
  'ДЕГИДРАТОР / DEHYDRATE',
  'РИС / RICE',
  'ПИЦЦА / PIZZA',
  'ТОСТ / TOAST',
  'РУЧНОЙ / MANUAL',
  'УМНЫЙ ПОВАР / SMART COOK',
]

export type Problems = Partial<Record<keyof Submission, string>>

/** Проверка формы — те же ограничения, что в таблице user_recipes. */
export function validate(s: Submission): Problems {
  const e: Problems = {}
  const t = s.title.trim()
  if (t.length < 3) e.title = 'Название — минимум 3 символа'
  else if (t.length > 120) e.title = 'Название — не длиннее 120 символов'
  if (s.intro.length > 1000) e.intro = 'Описание — не длиннее 1000 символов'
  if (!s.mode) e.mode = 'Выберите режим ГрандШефа'
  if (s.temp_c !== null && !(s.temp_c >= 30 && s.temp_c <= 260)) e.temp_c = 'Температура — от 30 до 260 °C'
  if (s.minutes !== null && !(s.minutes >= 1 && s.minutes <= 1440)) e.minutes = 'Время — от 1 до 1440 минут'
  if (s.servings !== null && !(s.servings >= 1 && s.servings <= 20)) e.servings = 'Порций — от 1 до 20'
  if (s.ingredients.length < 2) e.ingredients = 'Нужно минимум 2 ингредиента — по одному на строку'
  else if (s.ingredients.length > 40) e.ingredients = 'Не больше 40 ингредиентов'
  else if (s.ingredients.some((x) => x.length > 160)) e.ingredients = 'Слишком длинная строка ингредиента (до 160 символов)'
  if (s.steps.length < 1) e.steps = 'Опишите хотя бы один шаг'
  else if (s.steps.length > 30) e.steps = 'Не больше 30 шагов'
  if (s.image_url && !/^https:\/\/\S+$/.test(s.image_url)) e.image_url = 'Ссылка на фото должна начинаться с https://'
  return e
}

/** Строки «Название — количество»: тире любого вида приводим к « — ». */
export const normIngredient = (line: string) => line.trim().replace(/^[-•*·\d.)\s]+(?=\D)/, '').replace(/\s*[—–-]\s+|\s+[—–-]\s*/, ' — ')
export const splitLines = (text: string) =>
  text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
/** Шаги: «1. Нарезать…» → «Нарезать…». */
export const normStep = (line: string) => line.replace(/^(шаг\s*)?\d+\s*[.)]\s*/i, '').trim()

// ---------- dev без сервера ----------
const DEV_KEY = 'mgc:dev-user-recipes'
type DevStore = { pending: Pending[]; approved: { card: IndexItem; content: Recipe }[]; rejected?: MyRecipe[] }
function devLoad(): DevStore {
  try {
    const x = JSON.parse(localStorage.getItem(DEV_KEY) || 'null')
    return x && Array.isArray(x.pending) ? x : { pending: [], approved: [] }
  } catch {
    return { pending: [], approved: [] }
  }
}
const devSave = (s: DevStore) => localStorage.setItem(DEV_KEY, JSON.stringify(s))
const isDev = () => !configured && import.meta.env.DEV

export const devApprovedCards = (): IndexItem[] => (isDev() ? devLoad().approved.map((a) => a.card) : [])
export const devRecipeContent = (id: string): Recipe | null => (isDev() ? devLoad().approved.find((a) => a.card.id === id)?.content || null : null)

// ---------- API ----------
export async function submitRecipe(s: Submission): Promise<string> {
  if (isDev()) {
    const st = devLoad()
    const id = 'dev-' + Math.random().toString(36).slice(2, 10)
    st.pending.push({ ...s, id, created_at: new Date().toISOString(), status: 'pending', author: { name: 'Вы (локальный тест)' } })
    devSave(st)
    return id
  }
  const { data, error } = await (await sb()).rpc('submit_recipe', { p: s })
  if (error) throw error
  return data as string
}

export type MyRecipe = { id: string; title: string; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null; recipe_id: string | null; created_at: string }

/** Мои отправленные рецепты со статусом (RLS: видны только свои). */
export async function myRecipes(): Promise<MyRecipe[]> {
  if (isDev()) {
    const st = devLoad()
    return [
      ...st.pending.map((p) => ({ id: p.id, title: p.title, status: 'pending' as const, reject_reason: null, recipe_id: null, created_at: p.created_at })),
      ...st.approved.map((a) => ({ id: a.card.id, title: a.card.t, status: 'approved' as const, reject_reason: null, recipe_id: a.card.id, created_at: a.card.d })),
      ...(st.rejected || []),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  const { data, error } = await (await sb())
    .from('user_recipes')
    .select('id,title,status,reject_reason,recipe_id,created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data as MyRecipe[]) || []
}

export async function pendingRecipes(): Promise<Pending[]> {
  if (isDev()) return devLoad().pending
  const { data, error } = await (await sb()).rpc('admin_pending_recipes')
  if (error) throw error
  return ((data as Pending[]) || []).map((p) => ({
    ...p,
    ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
  }))
}

/** Решение модератора. Возвращает id опубликованного рецепта (или null при отказе). */
export async function reviewRecipe(id: string, approve: boolean, plans: string[], free: boolean, reason: string | null): Promise<string | null> {
  if (isDev()) {
    const st = devLoad()
    const u = st.pending.find((p) => p.id === id)
    if (!u) throw new Error('not_found')
    st.pending = st.pending.filter((p) => p.id !== id)
    if (!approve) {
      st.rejected = [{ id: u.id, title: u.title, status: 'rejected', reject_reason: reason, recipe_id: null, created_at: u.created_at }, ...(st.rejected || [])]
      devSave(st)
      return null
    }
    const rid = 'u' + id.replace(/\W/g, '').slice(-9)
    const today = new Date().toISOString().slice(0, 10)
    const mode = u.mode ? [u.mode] : []
    const trust = 35 + (u.mode ? 10 : 0) + (u.temp_c ? 8 : 0) + (u.minutes ? 7 : 0)
    const card: IndexItem = {
      id: rid, t: u.title, c: [u.category || 'Другое'], g: [], m: mode, min: u.minutes, tp: u.temp_c, tr: 35 + (u.mode ? 10 : 0),
      im: 0, img: u.image_url, v: 0, d: today, vw: 0, ing: u.ingredients.map((x) => x.split(' — ')[0].toLowerCase()), sk: ['owner'], ns: 1,
      srv: u.servings, srvE: 0, kc: null, p: null, f: null, cb: null, pl: plans, fr: free ? 1 : 0,
    }
    const content: Recipe = {
      id: rid, title: u.title, intro: u.intro, servings: u.servings, servings_estimated: u.servings === null,
      ingredients: u.ingredients.map((t) => ({ t })), steps: u.steps, modes: mode, modes_short: mode,
      temp_text: u.temp_c ? `${u.temp_c}°C` : null, time_text: u.minutes ? `${u.minutes} минут` : null, temps: u.temp_c ? [u.temp_c] : [],
      minutes: u.minutes, approx_minutes: u.minutes, nutrition: null, categories: [u.category || 'Другое'], tags: [], has_video: false,
      date: today, views: null, sources: [{ url: '', name: 'Владелец ГрандШефа · ' + (u.author?.name || 'Повар'), kind: 'owner', platform: 'MyGrandChef', date: today }],
      trust, trust_parts: [['Рецепт владельца ГрандШефа, прошёл модерацию', 35]],
    }
    st.approved.unshift({ card, content })
    devSave(st)
    return rid
  }
  const { data, error } = await (await sb()).rpc('admin_review_recipe', { p_id: id, p_approve: approve, p_plans: plans, p_free: free, p_reason: reason })
  if (error) throw error
  return (data as string) || null
}
