// Настройки «мозга» Бурмалдеца: провайдер, ключ, модель, голос. Всё хранится только на этом устройстве.
import { http } from './net'

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'mistral' | 'xai' | 'custom'
export type Kind = 'gemini' | 'openai' | 'anthropic'
export type Provider = {
  id: ProviderId
  name: string
  kind: Kind
  base: string
  keyUrl: string
  hint: string
  /** Что предложить, пока список моделей не загружен. */
  models: string[]
  /** Есть ли у провайдера свой голос / распознавание речи. */
  tts?: boolean
  stt?: string
  free?: boolean
}

export const PROVIDERS: Provider[] = [
  {
    id: 'gemini', name: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey', hint: 'Бесплатный ключ за минуту в Google AI Studio. Умеет голос и зрение.',
    models: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-flash-latest'], tts: true, stt: 'gemini', free: true,
  },
  {
    id: 'openai', name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', hint: 'Ключ из кабинета OpenAI (платно, по факту использования).',
    models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini'], tts: true, stt: 'gpt-4o-mini-transcribe',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', kind: 'anthropic', base: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys', hint: 'Ключ из консоли Anthropic. Очень умный, голос — системный.',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  {
    id: 'openrouter', name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys', hint: 'Сотни моделей по одному ключу, есть бесплатные (с пометкой :free).',
    models: ['google/gemini-flash-latest', 'openai/gpt-5-mini', 'anthropic/claude-haiku-5-5'],
  },
  {
    id: 'groq', name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys', hint: 'Очень быстрые ответы, есть бесплатный тариф. Распознаёт речь (Whisper).',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], stt: 'whisper-large-v3-turbo', free: true,
  },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', hint: 'Недорогой и умный.', models: ['deepseek-chat'] },
  { id: 'mistral', name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', hint: 'Европейские модели, есть бесплатный тариф.', models: ['mistral-small-latest', 'mistral-large-latest'], free: true },
  { id: 'xai', name: 'xAI Grok', kind: 'openai', base: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', hint: 'Модели Grok.', models: ['grok-4-fast'] },
  {
    id: 'custom', name: 'Свой сервер', kind: 'openai', base: 'http://localhost:11434/v1',
    keyUrl: '', hint: 'Любой OpenAI-совместимый адрес: Ollama, LM Studio, свой прокси. Ключ — если нужен.', models: [],
  },
]
export const provider = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]

export type VoiceEngine = 'auto' | 'gemini' | 'openai' | 'edge' | 'system'
export type SttEngine = 'auto' | 'system' | 'cloud' | 'vosk'
export type Cfg = {
  provider: ProviderId
  keys: Partial<Record<ProviderId, string>>
  model: string
  /** Запасные модели того же провайдера: включаются, если основная молчит или перегружена. */
  backup: string[]
  /** Адрес для «своего сервера». */
  base: string
  voice: VoiceEngine
  voiceName: string
  stt: SttEngine
  /** Своё дополнение к характеру. */
  persona: string
  setup: boolean
}

const KEY = 'bm:cfg'
const DEF: Cfg = { provider: 'gemini', keys: {}, model: 'gemini-3.5-flash-lite', backup: [], base: '', voice: 'auto', voiceName: '', stt: 'auto', persona: '', setup: false }
let cache: Cfg | null = null
const subs = new Set<() => void>()

export function getCfg(): Cfg {
  if (cache) return cache
  try {
    cache = { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Cfg>) }
  } catch {
    cache = { ...DEF }
  }
  return cache
}
export function setCfg(p: Partial<Cfg>) {
  cache = { ...getCfg(), ...p, keys: { ...getCfg().keys, ...(p.keys || {}) } }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* пусто */
  }
  subs.forEach((f) => f())
}
export function onCfg(f: () => void) {
  subs.add(f)
  return () => void subs.delete(f)
}
export const keyFor = (id: ProviderId) => (getCfg().keys[id] || '').trim()
export const baseFor = (id: ProviderId) => (id === 'custom' ? getCfg().base.trim().replace(/\/+$/, '') || provider('custom').base : provider(id).base)
/** Можно ли разговаривать с ИИ: есть ключ (или свой сервер). */
export const aiReady = () => {
  const c = getCfg()
  return !!c.model && (c.provider === 'custom' ? !!baseFor('custom') : !!keyFor(c.provider))
}

export function authHeaders(id: ProviderId): Record<string, string> {
  const p = provider(id)
  const k = keyFor(id)
  if (p.kind === 'gemini') return { 'x-goog-api-key': k }
  if (p.kind === 'anthropic') return { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
  const h: Record<string, string> = k ? { Authorization: 'Bearer ' + k } : {}
  if (id === 'openrouter') Object.assign(h, { 'HTTP-Referer': 'https://github.com/burmaldets', 'X-Title': 'Burmaldets' })
  return h
}

/** Модели, которые не годятся для разговора (картинки, эмбеддинги, озвучка...). */
const NOT_CHAT = /embed|tts|whisper|transcribe|audio|image|imagen|veo|dall-e|moderation|realtime|search|aqa|guard|rerank|ocr|computer-use|robotics|lyria|native-audio|live/i

/** Список моделей прямо у провайдера по ключу — заодно это проверка ключа. */
export async function listModels(id: ProviderId, key?: string, base?: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const p = provider(id)
  const k = (key ?? keyFor(id)).trim()
  const b = (base ?? baseFor(id)).replace(/\/+$/, '')
  try {
    let url = b + '/models'
    let headers: Record<string, string> = {}
    if (p.kind === 'gemini') {
      url += '?pageSize=1000'
      headers = { 'x-goog-api-key': k }
    } else if (p.kind === 'anthropic') {
      url += '?limit=100'
      headers = { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    } else if (k) headers = { Authorization: 'Bearer ' + k }
    const r = await http(url, { headers }, 15000)
    if (r.status === 401 || r.status === 403) return { ok: false, models: [], error: 'Ключ не подошёл (' + r.status + ')' }
    if (r.status !== 200) return { ok: false, models: [], error: 'Ответ ' + r.status + ': ' + r.body.slice(0, 160) }
    const j = JSON.parse(r.body) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; data?: { id: string }[] }
    let list: string[] = []
    if (p.kind === 'gemini') list = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
    else list = (j.data || []).map((m) => m.id)
    list = list.filter((m) => !NOT_CHAT.test(m))
    // привычные сначала, остальное по алфавиту
    const pref = p.models.filter((m) => list.includes(m))
    return { ok: true, models: [...pref, ...list.filter((m) => !pref.includes(m)).sort()] }
  } catch (e) {
    return { ok: false, models: [], error: 'Нет связи: ' + String(e).slice(0, 120) }
  }
}
