import { useSyncExternalStore } from 'react'

type State = {
  fav: string[]
  cooked: Record<string, { at: string; rating?: number; note?: string }>
  shop: { id: string; text: string; recipe?: string; recipeId?: string; done: boolean }[]
  recent: string[]
  fridge: string[]
  /** Что «всегда есть дома» для холодильника: ключи из STAPLES */
  staples: string[]
}

const KEY = 'mygrandchef:v1'
const empty: State = { fav: [], cooked: {}, shop: [], recent: [], fridge: [], staples: [] }

let state: State = (() => {
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return empty
  }
})()

const subs = new Set<() => void>()
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  localStorage.setItem(KEY, JSON.stringify(state))
  subs.forEach((f) => f())
}

/** Текущее состояние без подписки — для Шефа (корзина, холодильник, избранное). */
export const getState = () => state

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => sel(state),
  )
}

export const actions = {
  toggleFav(id: string) {
    set({ fav: state.fav.includes(id) ? state.fav.filter((x) => x !== id) : [id, ...state.fav] })
  },
  markCooked(id: string, rating?: number, note?: string) {
    const prev = state.cooked[id] || {}
    set({ cooked: { ...state.cooked, [id]: { ...prev, at: new Date().toISOString().slice(0, 10), rating: rating ?? prev.rating, note: note ?? prev.note } } })
  },
  unmarkCooked(id: string) {
    const c = { ...state.cooked }
    delete c[id]
    set({ cooked: c })
  },
  setNote(id: string, note: string) {
    const prev = state.cooked[id]
    if (prev) set({ cooked: { ...state.cooked, [id]: { ...prev, note } } })
  },
  addShop(items: string[], recipe?: string, recipeId?: string) {
    const existing = new Set(state.shop.map((s) => s.text + '|' + s.recipeId))
    const add = items
      .filter((t) => !existing.has(t + '|' + recipeId))
      .map((text) => ({ id: Math.random().toString(36).slice(2), text, recipe, recipeId, done: false }))
    set({ shop: [...state.shop, ...add] })
    return add.length
  },
  toggleShop(id: string) {
    set({ shop: state.shop.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) })
  },
  removeShop(id: string) {
    set({ shop: state.shop.filter((s) => s.id !== id) })
  },
  clearShop(onlyDone: boolean) {
    set({ shop: onlyDone ? state.shop.filter((s) => !s.done) : [] })
  },
  pushRecent(id: string) {
    set({ recent: [id, ...state.recent.filter((x) => x !== id)].slice(0, 30) })
  },
  setFridge(list: string[]) {
    set({ fridge: list })
  },
  toggleStaple(key: string) {
    set({ staples: state.staples.includes(key) ? state.staples.filter((x) => x !== key) : [...state.staples, key] })
  },
}
