import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useSyncExternalStore } from 'react'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const configured = Boolean(url && key)

let client: Promise<SupabaseClient> | null = null
/**
 * Клиент Supabase. Библиотека (~190 КБ) грузится отдельным чанком параллельно с каталогом,
 * а не в основном бандле — главная открывается быстрее.
 */
export function sb(): Promise<SupabaseClient> {
  if (!client)
    client = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      }),
    )
  return client
}

export type PlanCode = 'pp' | 'sweet' | 'weekday' | 'gourmet' | 'chef' | 'grandchef'
export type Access = {
  plans: PlanCode[]
  admin: boolean
  lifetime?: boolean
  subs?: { plan: PlanCode; expires_at: string | null; source: string }[]
}

/** Локальная разработка без Supabase. */
export const devMode = !configured && import.meta.env.DEV

/**
 * Только в dev без сервера: симуляция аккаунта, чтобы проверить пейволл, замки и тарифы.
 * localStorage 'mgc:dev-access' = '{"email":"me@test.kz","plans":["pp"],"admin":true}'.
 * В production-сборке (import.meta.env.DEV = false) не работает.
 */
type DevSim = Access & { email?: string }
const devSim: DevSim | null = (() => {
  if (!devMode) return null
  try {
    return JSON.parse(localStorage.getItem('mgc:dev-access') || 'null')
  } catch {
    return null
  }
})()
export const isDevSim = !!devSim

/** Бесплатный режим: сервер ещё не подключён — все рецепты и ассистент открыты всем без подписки. */
export const freeMode = !configured && !devSim

/** Аккаунты, отзывы, свои рецепты и админка — только с сервером. Без сервера эти разделы скрыты. */
export const accounts = configured || !!devSim

/** Включены ли ограничения доступа. В dev без сервера (и без симуляции) все рецепты открыты. */
export const gated = configured || !!devSim

type AuthState = {
  session: Session | null
  /** e-mail вошедшего пользователя (или симуляции в dev) */
  email: string | null
  access: Access
  /** сессия известна */
  ready: boolean
  /** доступ (my_access) загружен */
  loaded: boolean
}
const NONE: Access = { plans: [], admin: false }
let state: AuthState = { session: null, email: null, access: NONE, ready: false, loaded: false }
const subs = new Set<() => void>()
const emit = (patch: Partial<AuthState>) => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}

export async function refreshAccess() {
  if (!configured) return
  if (!state.session) return emit({ access: NONE, loaded: true })
  try {
    const { data } = await (await sb()).rpc('my_access')
    emit({ access: data ? (data as Access) : NONE, loaded: true })
  } catch {
    emit({ loaded: true })
  }
}

if (configured) {
  sb().then((supabase) => {
    supabase.auth.getSession().then(({ data }) => {
      emit({ session: data.session, email: data.session?.user.email ?? null, ready: true })
      refreshAccess()
    })
    supabase.auth.onAuthStateChange((_e, session) => {
      const changed = session?.user.id !== state.session?.user.id
      emit({ session, email: session?.user.email ?? null, ready: true, ...(changed ? { loaded: false } : {}) })
      if (changed) refreshAccess()
    })
  })
} else {
  state = {
    ...state,
    ready: true,
    loaded: true,
    email: devSim?.email || null,
    access: devSim ? { plans: devSim.plans || [], admin: !!devSim.admin, lifetime: devSim.lifetime, subs: devSim.subs } : NONE,
  }
}

export function useAuth() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => state,
  )
}

export function useRefreshOnFocus() {
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && refreshAccess()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
}

export async function signOut() {
  if (devSim) {
    localStorage.removeItem('mgc:dev-access')
    location.reload()
    return
  }
  await (await sb()).auth.signOut()
}

/** Стабильный id устройства — для ограничения числа устройств на аккаунт. */
export function deviceId() {
  let id = localStorage.getItem('mgc:device')
  if (!id) {
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + ':' + (navigator.platform || 'web').slice(0, 16)
    localStorage.setItem('mgc:device', id)
  }
  return id
}

export const hasAll = (a: Access) => a.plans.includes('chef') || a.plans.includes('grandchef')
export const canOpen = (a: Access, plans: string[], free: boolean) => free || hasAll(a) || plans.some((p) => a.plans.includes(p as PlanCode))
/** Можно ли пользоваться шеф-ассистентом. В dev без сервера — да, чтобы можно было тестировать. */
export const canPlan = (a: Access) => a.plans.includes('grandchef') || freeMode

export const ERRORS: Record<string, string> = {
  auth_required: 'Войдите, чтобы открыть рецепт',
  locked: 'Рецепт доступен по подписке',
  rate_limited: 'Слишком много новых рецептов за час. Сделайте паузу — лимит снимется сам.',
  temporarily_blocked: 'Аккаунт временно ограничен из-за подозрения на массовое копирование. Напишите в поддержку.',
  too_many_devices: 'Аккаунт уже используется на 3 других устройствах за последние 30 дней. Одна подписка — для вас и вашей семьи, но не для раздачи.',
  not_found: 'Рецепт не найден',
  planner_limit: 'Лимит 100 генераций в этом месяце исчерпан',
  grandchef_required: 'Нужна подписка Grand Chef',
  user_not_found: 'Пользователь с таким e-mail не найден — он должен сначала зарегистрироваться',
  forbidden: 'Нет прав администратора',
}
export const errText = (e: unknown) => {
  const m = (e as { message?: string })?.message || String(e)
  const k = Object.keys(ERRORS).find((x) => m.includes(x))
  return k ? ERRORS[k] : 'Что-то пошло не так. Попробуйте ещё раз.'
}
export const errCode = (e: unknown) => {
  const m = (e as { message?: string })?.message || String(e)
  return Object.keys(ERRORS).find((x) => m.includes(x)) || 'unknown'
}

/** Аватар-кружок: цвет из e-mail. */
export const hueOf = (s: string) => [...s].reduce((x, c) => x + c.charCodeAt(0), 0) % 360
