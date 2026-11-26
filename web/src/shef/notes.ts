// Заметки: «запиши заметку…», «прочитай заметки», «удали заметку про…». Хранятся на устройстве.
const KEY = 'shef:notes'
export type Note = { text: string; at: number }

function load(): Note[] {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}
function save(l: Note[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l.slice(-200)))
  } catch {
    /* пусто */
  }
}
const low = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

export function addNote(text: string) {
  const t = text.trim()
  if (!t) return { ok: false, error: 'Что записать?' }
  save([...load(), { text: t, at: Date.now() }])
  return { ok: true, saved: t, total: load().length }
}

export function listNotes(query = '') {
  const ws = low(query).match(/[а-яa-z0-9]{3,}/g) || []
  const l = load()
    .filter((n) => !ws.length || ws.some((w) => low(n.text).includes(w.slice(0, Math.max(3, w.length - 2)))))
    .reverse()
  return { count: l.length, notes: l.slice(0, 15).map((n) => ({ text: n.text, when: new Date(n.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })) }
}

export function deleteNotes(query: string) {
  const q = low(query).trim()
  const l = load()
  if (/^(все|всё|все заметки)$/.test(q)) {
    save([])
    return { ok: true, deleted: l.length }
  }
  const ws = q.match(/[а-яa-z0-9]{3,}/g) || []
  const keep = l.filter((n) => !ws.some((w) => low(n.text).includes(w.slice(0, Math.max(3, w.length - 2)))))
  save(keep)
  return l.length - keep.length ? { ok: true, deleted: l.length - keep.length } : { ok: false, note: 'Такой заметки нет.' }
}

export const allNotes = () => load().slice().reverse()
export function deleteNoteAt(at: number) {
  save(load().filter((n) => n.at !== at))
}
