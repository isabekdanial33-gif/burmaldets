// Что сейчас готовим с Бурмалдецом: рецепт и номер шага. Переживает перезагрузку.
import type { Recipe } from '../data'

type S = { recipe: Recipe | null; step: number }
const KEY = 'shef:session'
let s: S = (() => {
  try {
    return { recipe: null, step: -1, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }
  } catch {
    return { recipe: null, step: -1 }
  }
})()
export const session = () => s
export function setSession(p: Partial<S>) {
  s = { ...s, ...p }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* пусто */
  }
}
