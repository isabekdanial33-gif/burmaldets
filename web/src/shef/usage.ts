// Эко-лимит (как в Джарвисе): сколько запросов и токенов ИИ потрачено сегодня, и стоп, когда лимит исчерпан.
// Когда лимит кончился, ИИ не вызывается — работают навыки без ИИ (погода, курсы, таймеры, заметки…).
import { getCfg } from './ai'

export type Usage = { day: string; requests: number; tokens: number; byAgent: Record<string, { requests: number; tokens: number }> }
const KEY = 'bm:usage'
const today = () => new Date().toLocaleDateString('sv-SE')

export function getUsage(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) || 'null') as Usage | null
    if (u && u.day === today()) return { ...u, byAgent: u.byAgent || {} }
  } catch {
    /* пусто */
  }
  return { day: today(), requests: 0, tokens: 0, byAgent: {} }
}

const subs = new Set<() => void>()
export const onUsage = (f: () => void) => (subs.add(f), () => void subs.delete(f))

/** Записать один ответ ИИ: сколько токенов ушло (если провайдер сообщил). */
export function addUsage(tokens: number, who = 'main') {
  const u = getUsage()
  u.requests++
  u.tokens += Math.max(0, Math.round(tokens) || 0)
  const a = (u.byAgent[who] ||= { requests: 0, tokens: 0 })
  a.requests++
  a.tokens += Math.max(0, Math.round(tokens) || 0)
  try {
    localStorage.setItem(KEY, JSON.stringify(u))
  } catch {
    /* пусто */
  }
  subs.forEach((f) => f())
}

/** Лимит исчерпан? 0 в настройках — без ограничения. */
export function overLimit(): string | null {
  const c = getCfg()
  if (c.eco === false) return null
  const u = getUsage()
  const maxReq = c.limitRequests ?? 0
  const maxTok = c.limitTokens ?? 0
  if (maxReq > 0 && u.requests >= maxReq) return `запросов ${u.requests} из ${maxReq}`
  if (maxTok > 0 && u.tokens >= maxTok) return `токенов ${u.tokens} из ${maxTok}`
  return null
}

/** Токены из ответа любого провайдера (Gemini usageMetadata, OpenAI usage, Anthropic usage). */
export function tokensOf(j: Record<string, unknown>): number {
  const g = j.usageMetadata as { totalTokenCount?: number } | undefined
  if (g?.totalTokenCount) return g.totalTokenCount
  const u = j.usage as { total_tokens?: number; input_tokens?: number; output_tokens?: number } | undefined
  if (u?.total_tokens) return u.total_tokens
  if (u) return (u.input_tokens || 0) + (u.output_tokens || 0)
  return 0
}
