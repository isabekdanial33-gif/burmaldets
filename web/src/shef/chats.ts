// Чаты и проекты (как в ChatGPT): у каждого чата своя история, у проекта — общие инструкции и свой агент.
// Всё хранится только на устройстве.
import type { Content } from './llm'

export type ChatLog = { r: 'u' | 'a'; t: string; at: number }
export type Chat = { id: string; title: string; projectId?: string; agentId?: string; at: number; updated: number; history: Content[]; log: ChatLog[] }
export type Project = { id: string; name: string; instructions: string; agentId?: string; at: number }
type Store = { chats: Chat[]; projects: Project[]; active: string }

const KEY = 'bm:chats'
const OLD = 'shef:history'
const uid = () => Math.random().toString(36).slice(2, 10)
/** Голосом вернулись через несколько часов — это уже новый разговор, а не продолжение (и экономнее). */
const FRESH_AFTER = 3 * 3600000

let store: Store | null = null
const subs = new Set<() => void>()
export const onChats = (f: () => void) => (subs.add(f), () => void subs.delete(f))

function load(): Store {
  if (store) return store
  try {
    store = JSON.parse(localStorage.getItem(KEY) || 'null') as Store | null
  } catch {
    store = null
  }
  if (!store || !Array.isArray(store.chats)) {
    store = { chats: [], projects: [], active: '' }
    // перенос старого разговора (до чатов)
    try {
      const old = JSON.parse(localStorage.getItem(OLD) || 'null') as { at: number; h: Content[] } | null
      if (old?.h?.length) {
        const c = blank()
        c.history = old.h
        c.title = firstText(old.h) || 'Разговор'
        store.chats.push(c)
        store.active = c.id
      }
    } catch {
      /* пусто */
    }
  }
  return store
}

function persist() {
  const s = load()
  // ограничиваем размер: 200 чатов, в каждом журнал до 300 реплик
  s.chats = s.chats.sort((a, b) => b.updated - a.updated).slice(0, 200)
  for (const c of s.chats) if (c.log.length > 300) c.log = c.log.slice(-300)
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // переполнено — выкидываем самые старые чаты
    s.chats = s.chats.slice(0, Math.max(10, Math.floor(s.chats.length / 2)))
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* пусто */
    }
  }
  subs.forEach((f) => f())
}

const blank = (o: Partial<Chat> = {}): Chat => ({ id: uid(), title: 'Новый чат', at: Date.now(), updated: Date.now(), history: [], log: [], ...o })
const firstText = (h: Content[]) =>
  h
    .find((c) => c.role === 'user' && c.parts.some((p) => p.text))
    ?.parts.find((p) => p.text)
    ?.text?.slice(0, 60)

export const listChats = () => load().chats.slice().sort((a, b) => b.updated - a.updated)
export const listProjects = () => load().projects.slice().sort((a, b) => a.at - b.at)
export const getProject = (id?: string) => (id ? load().projects.find((p) => p.id === id) : undefined)

export function activeChat(): Chat {
  const s = load()
  let c = s.chats.find((x) => x.id === s.active)
  if (!c) {
    c = blank()
    s.chats.push(c)
    s.active = c.id
    persist()
  }
  return c
}

export function newChat(o: { projectId?: string; agentId?: string } = {}): Chat {
  const s = load()
  const cur = s.chats.find((x) => x.id === s.active)
  // пустой текущий чат не плодим — просто переиспользуем
  if (cur && !cur.log.length && !cur.history.length) {
    Object.assign(cur, { projectId: o.projectId, agentId: o.agentId, updated: Date.now() })
    persist()
    return cur
  }
  const c = blank(o)
  s.chats.push(c)
  s.active = c.id
  persist()
  return c
}

export function openChat(id: string) {
  const s = load()
  if (!s.chats.some((c) => c.id === id)) return
  s.active = id
  persist()
}

/** Перед новой репликой: если чат давно молчит — начинаем новый в том же проекте и с тем же агентом. */
export function freshIfStale(): boolean {
  const c = activeChat()
  if (c.log.length && Date.now() - c.updated > FRESH_AFTER) {
    newChat({ projectId: c.projectId, agentId: c.agentId })
    return true
  }
  return false
}

export function saveChatHistory(h: Content[]) {
  const c = activeChat()
  c.history = h
  c.updated = Date.now()
  persist()
}

export function logTurn(user: string, reply: string) {
  const c = activeChat()
  const at = Date.now()
  if (user) c.log.push({ r: 'u', t: user, at })
  if (reply) c.log.push({ r: 'a', t: reply, at })
  if (c.title === 'Новый чат' && user) c.title = user.slice(0, 60)
  c.updated = at
  persist()
}

export function updateChat(id: string, p: Partial<Pick<Chat, 'title' | 'projectId' | 'agentId'>>) {
  const c = load().chats.find((x) => x.id === id)
  if (!c) return
  Object.assign(c, p)
  persist()
}

export function deleteChat(id: string) {
  const s = load()
  s.chats = s.chats.filter((c) => c.id !== id)
  if (s.active === id) s.active = ''
  persist()
}

export function addProject(p: { name: string; instructions?: string; agentId?: string }): Project {
  const pr: Project = { id: uid(), name: p.name.trim() || 'Проект', instructions: p.instructions || '', agentId: p.agentId, at: Date.now() }
  load().projects.push(pr)
  persist()
  return pr
}

export function updateProject(id: string, p: Partial<Omit<Project, 'id' | 'at'>>) {
  const pr = load().projects.find((x) => x.id === id)
  if (!pr) return
  Object.assign(pr, p)
  persist()
}

/** Удалить проект; его чаты остаются, просто без проекта. */
export function deleteProject(id: string) {
  const s = load()
  s.projects = s.projects.filter((p) => p.id !== id)
  for (const c of s.chats) if (c.projectId === id) c.projectId = undefined
  persist()
}
