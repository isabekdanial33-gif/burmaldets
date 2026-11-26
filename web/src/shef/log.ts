// Журнал недоработок «Бурмалдеца»: что не понял, где ошибся, что заметил в рецептах.
// На телефоне — файл Android/data/kz.mygrandchef.shef/files/Бурмалдец-журнал.txt, на компьютере — в браузере (кнопка «Журнал»).
import { isAndroid, nativeCall } from './bridge'

const KEY = 'shef:log'
export type LogKind = 'не понял' | 'не расслышал' | 'ошибка' | 'недоработка' | 'заметка'

export function shefLog(kind: LogKind, text: string) {
  const line = `${new Date().toLocaleString('ru-RU')} [${kind}] ${text.replace(/\s+/g, ' ').slice(0, 600)}`
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]') as string[]
    all.push(line)
    localStorage.setItem(KEY, JSON.stringify(all.slice(-500)))
  } catch {
    /* хранилище переполнено — не страшно */
  }
  if (isAndroid) nativeCall('log', { line }, 5000).catch(() => {})
}
export const readLog = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}
export function downloadLog() {
  const blob = new Blob([readLog().join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'Бурмалдец-журнал.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
