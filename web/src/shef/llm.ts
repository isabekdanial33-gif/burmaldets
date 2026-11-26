// Разговор с ИИ. Внутри Гудвин думает в формате Gemini (Content/Part), а для других провайдеров
// запрос и ответ переводятся: OpenAI-совместимые (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI, свой сервер) и Anthropic.
// Если модель перегружена или молчит — параллельно спрашиваем запасную (см. hedged).
import { authHeaders, baseFor, getCfg, keyFor, provider, type Brain, type ProviderId } from './ai'
import { addUsage, overLimit, tokensOf } from './usage'
import { http } from './net'

export type Part = {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; response: unknown; id?: string }
  thoughtSignature?: string
  thought?: boolean
}
export type Content = { role: 'user' | 'model'; parts: Part[] }
type Body = {
  systemInstruction?: { parts: Part[] }
  contents: Content[]
  tools?: { functionDeclarations: { name: string; description: string; parameters: unknown }[] }[]
  generationConfig?: { temperature?: number; maxOutputTokens?: number; thinkingConfig?: Record<string, unknown> }
}

const HEDGE_MS = 4500
// у бесплатного ключа Gemini ~10 озвучек в сутки на модель — поэтому цепочка из всех TTS-моделей
const TTS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']

type Raw = { status: number; body: string }

export class LlmError extends Error {
  code: string
  constructor(code: string, msg?: string) {
    super(msg || code)
    this.code = code
  }
}

// ---------- перевод в формат OpenAI ----------
type OaMsg = { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }
let idSeq = 0
const newId = () => 'call_' + Date.now().toString(36) + '_' + ++idSeq

/** У вызова инструмента и ответа на него должен быть общий id — если его нет (история от Gemini), ставим по порядку. */
function withIds(contents: Content[]): Content[] {
  const queue = new Map<string, string[]>()
  return contents.map((c) => ({
    ...c,
    parts: c.parts.map((p) => {
      if (p.functionCall) {
        const id = p.functionCall.id || newId()
        queue.set(p.functionCall.name, [...(queue.get(p.functionCall.name) || []), id])
        return { ...p, functionCall: { ...p.functionCall, id } }
      }
      if (p.functionResponse) {
        const q = queue.get(p.functionResponse.name) || []
        const id = p.functionResponse.id && q.includes(p.functionResponse.id) ? p.functionResponse.id : q[0] || newId()
        queue.set(p.functionResponse.name, q.filter((x) => x !== id))
        return { ...p, functionResponse: { ...p.functionResponse, id } }
      }
      return p
    }),
  }))
}

export function toOpenAI(model: string, b: Body) {
  const msgs: OaMsg[] = []
  const sys = (b.systemInstruction?.parts || []).map((p) => p.text || '').join('\n')
  if (sys) msgs.push({ role: 'system', content: sys })
  for (const c of withIds(b.contents)) {
    if (c.role === 'model') {
      const text = c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('')
      // extra_content — служебное поле провайдера (у Gemini — «подпись мысли»), без него он не примет историю
      const calls = c.parts
        .filter((p) => p.functionCall)
        .map((p) => ({ id: p.functionCall!.id, type: 'function', function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args || {}) }, ...(p.thoughtSignature ? { extra_content: { google: { thought_signature: p.thoughtSignature } } } : {}) }))
      if (!text && !calls.length) continue
      msgs.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    for (const p of c.parts) if (p.functionResponse) msgs.push({ role: 'tool', tool_call_id: p.functionResponse.id, content: JSON.stringify(p.functionResponse.response ?? {}) })
    const rest = c.parts.filter((p) => !p.functionResponse && (p.text || p.inlineData))
    if (!rest.length) continue
    const onlyText = rest.every((p) => p.text)
    msgs.push({
      role: 'user',
      content: onlyText
        ? rest.map((p) => p.text).join('\n')
        : rest.map((p) => (p.text ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}` } })),
    })
  }
  const decl = b.tools?.flatMap((t) => t.functionDeclarations) || []
  return {
    model,
    messages: msgs,
    ...(decl.length ? { tools: decl.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } })) } : {}),
    ...(b.generationConfig?.temperature != null ? { temperature: b.generationConfig.temperature } : {}),
  }
}

export function fromOpenAI(j: { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string }; extra_content?: { google?: { thought_signature?: string } } }[] } }[] }): Part[] {
  const m = j.choices?.[0]?.message
  if (!m) return []
  const parts: Part[] = []
  // часть моделей прячет рассуждения в <think>…</think> — их не озвучиваем
  const text = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (text) parts.push({ text })
  for (const t of m.tool_calls || []) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(t.function.arguments || '{}')
    } catch {
      /* кривой JSON — без аргументов */
    }
    const sig = t.extra_content?.google?.thought_signature
    parts.push({ functionCall: { name: t.function.name, args, id: t.id }, ...(sig ? { thoughtSignature: sig } : {}) })
  }
  return parts
}

// ---------- перевод в формат Anthropic ----------
export function toAnthropic(model: string, b: Body) {
  type Block = Record<string, unknown>
  const msgs: { role: 'user' | 'assistant'; content: Block[] }[] = []
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else msgs.push({ role, content: blocks })
  }
  for (const c of withIds(b.contents)) {
    if (c.role === 'model') {
      push('assistant', c.parts.flatMap((p): Block[] => (p.functionCall ? [{ type: 'tool_use', id: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args || {} }] : p.text && !p.thought ? [{ type: 'text', text: p.text }] : [])))
      continue
    }
    // ответы инструментов — первыми в сообщении пользователя
    const res = c.parts.filter((p) => p.functionResponse).map((p) => ({ type: 'tool_result', tool_use_id: p.functionResponse!.id, content: JSON.stringify(p.functionResponse!.response ?? {}) }))
    const rest = c.parts.flatMap((p): Block[] =>
      p.text ? [{ type: 'text', text: p.text }] : p.inlineData && /^image\//.test(p.inlineData.mimeType) ? [{ type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } }] : [],
    )
    push('user', [...res, ...rest])
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift()
  const decl = b.tools?.flatMap((t) => t.functionDeclarations) || []
  return {
    model,
    max_tokens: Math.max(1024, b.generationConfig?.maxOutputTokens || 0),
    system: (b.systemInstruction?.parts || []).map((p) => p.text || '').join('\n'),
    messages: msgs,
    ...(decl.length ? { tools: decl.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters })) } : {}),
    ...(b.generationConfig?.temperature != null ? { temperature: b.generationConfig.temperature } : {}),
  }
}

export function fromAnthropic(j: { content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] }): Part[] {
  return (j.content || []).flatMap((c): Part[] => (c.type === 'text' && c.text ? [{ text: c.text }] : c.type === 'tool_use' ? [{ functionCall: { name: c.name!, args: c.input || {}, id: c.id } }] : []))
}

/** Один запрос к выбранному провайдеру. Ответ всегда в виде Gemini: {candidates:[{content:{parts}}]}. */
/** Один запрос. brain — ключ и адрес агента (иначе — из основных настроек). */
async function raw(pid: ProviderId, model: string, body: Body, timeoutMs: number, brain?: Brain): Promise<Raw> {
  const p = provider(pid)
  const b = brain && brain.provider === pid ? brain : null
  const base = (b?.base || '').trim().replace(/\/+$/, '') || baseFor(pid)
  const headers = { 'Content-Type': 'application/json', ...authHeaders(pid, b?.key) }
  const who = b?.who || 'main'
  if (p.kind === 'gemini') {
    const r = await http(`${base}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs)
    if (r.status === 200)
      try {
        addUsage(tokensOf(JSON.parse(r.body)), who)
      } catch {
        /* пусто */
      }
    return r
  }
  const isA = p.kind === 'anthropic'
  const r = await http(isA ? base + '/messages' : base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(isA ? toAnthropic(model, body) : toOpenAI(model, body)) }, timeoutMs)
  if (r.status !== 200) return r
  try {
    addUsage(tokensOf(JSON.parse(r.body)), who)
  } catch {
    /* пусто */
  }
  try {
    const parts = isA ? fromAnthropic(JSON.parse(r.body)) : fromOpenAI(JSON.parse(r.body))
    return { status: 200, body: JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }) }
  } catch {
    return { status: 502, body: r.body.slice(0, 300) }
  }
}

/** Модель, которая недавно была перегружена, какое-то время пропускаем — не ждём её зря. */
const cooldown = new Map<string, number>(
  Object.keys(localStorage)
    .filter((k) => k.startsWith('bm:cd:'))
    .map((k) => [k.slice(6), Number(localStorage.getItem(k)) || 0]),
)
function cool(model: string, r: Raw) {
  const until = Date.now() + (r.status === 429 ? (/PerDay|per day|daily/i.test(r.body) ? 6 * 3600000 : 2 * 60000) : 90000)
  cooldown.set(model, until)
  if (r.status === 429) localStorage.setItem('bm:cd:' + model, String(until))
}
const fatal = (r: Raw) => (r.status === 401 || r.status === 403 ? 'key' : r.status === 404 || (r.status === 400 && /model/i.test(r.body) && /not|invalid|exist|found|support/i.test(r.body)) ? 'model' : r.status === 402 ? 'money' : '')

/** Перебор моделей с общим сроком: лучше быстро ответить запасным путём, чем молчать минуту. */
async function chain(pid: ProviderId, models: string[], body: Body, perModel: number, budget: number): Promise<{ model: string; json: Record<string, unknown> }> {
  let last: LlmError = new LlmError('offline')
  const end = Date.now() + budget
  const live = models.filter((m) => (cooldown.get(m) || 0) < Date.now())
  if (!live.length && models === TTS) throw new LlmError('limit', 'tts daily limit')
  for (const model of live.length ? live : models) {
    const left = end - Date.now()
    if (left < 1500) {
      last = new LlmError('slow', 'budget')
      break
    }
    try {
      const r = await raw(pid, model, body, Math.min(perModel, left))
      if (r.status === 200) return { model, json: JSON.parse(r.body) }
      const f = fatal(r)
      if (f === 'key' || f === 'money') throw new LlmError(f, r.body.slice(0, 300))
      last = new LlmError(f || (r.status === 429 ? 'limit' : 'busy'), r.body.slice(0, 300))
      cool(model, r)
    } catch (e) {
      if (e instanceof LlmError && (e.code === 'key' || e.code === 'money')) throw e
      last = e instanceof LlmError ? e : new LlmError(navigator.onLine ? 'slow' : 'offline', String(e))
      cooldown.set(model, Date.now() + 3 * 60000)
    }
  }
  throw last
}

/**
 * Страхующие запросы: если модель молчит дольше HEDGE_MS — параллельно спрашиваем следующую и берём первый ответ.
 * Отказ (перегрузка/лимит) — сразу следующая.
 */
function hedged(pid: ProviderId, models: string[], body: Body, perModel: number, budget: number, hedgeMs = HEDGE_MS, brain?: Brain): Promise<{ model: string; json: Record<string, unknown> }> {
  const end = Date.now() + budget
  const live = models.filter((m) => (cooldown.get(m) || 0) < Date.now())
  const order = live.length ? live : models
  return new Promise((resolve, reject) => {
    let i = 0
    let pending = 0
    let done = false
    let retried = false
    let last: LlmError = new LlmError('offline')
    let timer = 0
    const inflight = new Set<string>()
    const finish = () => {
      if (done || pending > 0 || i < order.length) return
      // все быстро отказали из-за перегрузки — одна повторная попытка через полторы секунды, если есть время
      if (!retried && (last.code === 'busy' || last.code === 'limit') && end - Date.now() > 5000) {
        retried = true
        i = 0
        window.setTimeout(launch, 1500)
        return
      }
      done = true
      reject(last)
    }
    const launch = () => {
      clearTimeout(timer)
      if (done || i >= order.length) return finish()
      const model = order[i++]
      const left = end - Date.now()
      if (left < 1500) {
        last = new LlmError('slow', 'budget')
        i = order.length
        return finish()
      }
      pending++
      inflight.add(model)
      raw(pid, model, body, Math.min(perModel, left), brain).then(
        (r) => {
          pending--
          inflight.delete(model)
          if (done) return
          if (r.status === 200) {
            done = true
            clearTimeout(timer)
            for (const m of order.slice(0, order.indexOf(model))) if (inflight.has(m)) cooldown.set(m, Math.max(cooldown.get(m) || 0, Date.now() + 60000))
            try {
              resolve({ model, json: JSON.parse(r.body) })
            } catch {
              reject(new LlmError('empty', 'bad json'))
            }
            return
          }
          const f = fatal(r)
          if (f === 'key' || f === 'money') {
            done = true
            clearTimeout(timer)
            reject(new LlmError(f, r.body.slice(0, 300)))
            return
          }
          last = new LlmError(f || (r.status === 429 ? 'limit' : 'busy'), r.body.slice(0, 300))
          cool(model, r)
          if (i < order.length) launch()
          else finish()
        },
        (e) => {
          pending--
          inflight.delete(model)
          if (done) return
          last = e instanceof LlmError ? e : new LlmError(navigator.onLine ? 'slow' : 'offline', String(e))
          cooldown.set(model, Date.now() + 3 * 60000)
          if (i < order.length) launch()
          else finish()
        },
      )
      if (i < order.length) timer = window.setTimeout(launch, hedgeMs)
    }
    launch()
  })
}

/** Основная модель и запасные. Для бесплатного Gemini запасные подставляются сами — он часто перегружен. */
export function chatModels(): string[] {
  const c = getCfg()
  const list = [c.model, ...c.backup].filter(Boolean)
  if (c.provider === 'gemini' && !c.backup.length) list.push(...provider('gemini').models.filter((m) => m !== c.model).slice(0, 2))
  return [...new Set(list)]
}

export async function chat(body: Body, brain?: Brain): Promise<{ model: string; content: Content }> {
  const lim = overLimit()
  if (lim) throw new LlmError('quota', lim)
  const c = getCfg()
  const pid = brain?.provider || c.provider
  const key = brain ? (brain.key ?? keyFor(pid)) : keyFor(pid)
  const model0 = brain ? brain.model : c.model
  if (!model0 || (pid !== 'custom' && !key)) throw new LlmError('no_key')
  // локальные модели думают дольше — даём им больше времени
  const slow = pid === 'custom'
  // у агента тоже есть запасные: перегружена его модель — берём соседнюю того же провайдера (с тем же ключом)
  const models = brain
    ? [...new Set([brain.model, ...(brain.backup?.length ? brain.backup : pid === 'gemini' ? provider('gemini').models.filter((m) => m !== brain.model).slice(0, 2) : [])])]
    : chatModels()
  const { model, json } = await hedged(pid, models, body, slow ? 45000 : 12000, slow ? 50000 : 16000, HEDGE_MS, brain)
  const cand = (json.candidates as { content?: Content }[] | undefined)?.[0]
  if (!cand?.content?.parts?.length) throw new LlmError('empty', JSON.stringify(json).slice(0, 300))
  return { model, content: { role: 'model', parts: cand.content.parts } }
}

/** Короткая проверка: модель отвечает? (для экрана настройки) */
export async function ping(pid: ProviderId, model: string, brain?: Brain): Promise<{ ok: boolean; ms: number; text?: string; error?: string }> {
  const t = Date.now()
  try {
    const r = await raw(pid, model, { contents: [{ role: 'user', parts: [{ text: 'Ответь одним словом: привет' }] }], generationConfig: { maxOutputTokens: 400 } }, 30000, brain)
    if (r.status !== 200) return { ok: false, ms: Date.now() - t, error: `${r.status}: ${r.body.slice(0, 200)}` }
    const parts = (JSON.parse(r.body).candidates?.[0]?.content?.parts || []) as Part[]
    return { ok: true, ms: Date.now() - t, text: parts.map((p) => (p.thought ? '' : p.text || '')).join('').trim() }
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e) }
  }
}

// ---------- голос ----------
/** Голос Gemini → WAV (Blob). Только сам текст: любая «подсказка стиля» модель иногда зачитывает вслух. */
export async function tts(text: string, voice = 'Achird'): Promise<Blob> {
  if (!keyFor('gemini')) throw new LlmError('no_key')
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  } as unknown as Body
  const { json } = await chain('gemini', TTS, body, 6000, 7000)
  const p = (json.candidates as { content: { parts: Part[] } }[])[0].content.parts.find((x) => x.inlineData)?.inlineData
  if (!p) throw new LlmError('empty')
  const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))
  return p.mimeType.includes('wav') ? new Blob([bytes], { type: 'audio/wav' }) : new Blob([wavHeader(bytes.length, 24000), bytes], { type: 'audio/wav' })
}

/** Голос OpenAI → MP3 (Blob). */
export async function ttsOpenAI(text: string, voice = 'onyx'): Promise<Blob> {
  if (!keyFor('openai')) throw new LlmError('no_key')
  const r = await http(baseFor('openai') + '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders('openai') },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
    binary: true,
  }, 12000)
  if (r.status !== 200 || !r.b64) throw new LlmError(r.status === 429 ? 'limit' : 'busy', r.body)
  return new Blob([Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0))], { type: 'audio/mpeg' })
}

// ---------- распознавание речи в облаке (компьютер) ----------
/** Какой облачный распознаватель доступен по ключам: Groq/OpenAI (Whisper) или Gemini. */
export function cloudStt(): ProviderId | null {
  for (const id of ['gemini', 'openai', 'groq'] as ProviderId[]) if (keyFor(id)) return id
  return null
}

export async function transcribe(audio: Blob, hint = ''): Promise<string> {
  const pid = cloudStt()
  if (!pid) throw new LlmError('no_key')
  const bytes = new Uint8Array(await audio.arrayBuffer())
  if (pid === 'gemini') {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Дословно запиши речь из аудио (обычно по-русски). Верни только сам текст, без кавычек и пояснений. Если речи нет — верни пустую строку.' }, { inlineData: { mimeType: audio.type.split(';')[0] || 'audio/webm', data: btoa(s) } }] }],
      // без «размышлений» расшифровка в 2–4 раза быстрее; запасная модель — параллельно через 1,8 с
      generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } },
    } as Body
    const { json } = await hedged('gemini', ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'], body, 8000, 10000, 1800)
    return ((json.candidates as { content: { parts: Part[] } }[])[0]?.content.parts || []).map((p) => (p.thought ? '' : p.text || '')).join('').trim()
  }
  // Whisper: multipart/form-data собираем вручную — так он проходит через нативный мост
  const bnd = '----bm' + Math.random().toString(36).slice(2)
  const enc = new TextEncoder()
  const head = (name: string, extra = '') => enc.encode(`--${bnd}\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n\r\n`)
  const ext = /ogg/.test(audio.type) ? 'ogg' : /wav/.test(audio.type) ? 'wav' : 'webm'
  const chunks = [
    head('model'), enc.encode(provider(pid).stt + '\r\n'),
    head('language'), enc.encode('ru\r\n'),
    ...(hint ? [head('prompt'), enc.encode(hint + '\r\n')] : []),
    head('file', `; filename="speech.${ext}"\r\nContent-Type: ${audio.type.split(';')[0] || 'audio/webm'}`), bytes, enc.encode(`\r\n--${bnd}--\r\n`),
  ]
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  let s = ''
  for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000))
  const r = await http(baseFor(pid) + '/audio/transcriptions', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + bnd, ...authHeaders(pid), 'x-body-b64': '1' }, body: btoa(s) }, 15000)
  if (r.status !== 200) throw new LlmError(r.status === 429 ? 'limit' : 'busy', r.body.slice(0, 200))
  return (JSON.parse(r.body).text || '').trim()
}

/**
 * Вторая проверка слова-активатора на компьютере: действительно ли прозвучало «Гудвин».
 * Gemini отвечает «да/нет» по звуку; Whisper (Groq/OpenAI) записывает речь с подсказкой этих слов.
 * null — проверить нечем или облако не успело: тогда решает распознаватель на компьютере.
 */
export async function verifyName(audio: Blob, ms = 3000): Promise<boolean | null> {
  const pid = cloudStt()
  if (!pid) return null
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), ms))
  const job = (async (): Promise<boolean | null> => {
    if (pid === 'gemini') {
      const bytes = new Uint8Array(await audio.arrayBuffer())
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const body = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Голосового ассистента зовут «Гудвин». Прозвучало ли в этой записи это имя — отчётливо, именно это слово (похожие обычные слова не считаются)? Ответь одним словом: да или нет.' },
              { inlineData: { mimeType: 'audio/wav', data: btoa(s) } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 5, thinkingConfig: { thinkingLevel: 'minimal' } },
      } as Body
      const { json } = await hedged('gemini', ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'], body, ms, ms + 500, 1200)
      const t = ((json.candidates as { content: { parts: Part[] } }[])[0]?.content.parts || []).map((p) => (p.thought ? '' : p.text || '')).join('').trim().toLowerCase()
      return /^да/.test(t) ? true : /^нет/.test(t) ? false : null
    }
    const t = await transcribe(audio, 'Гудвин.')
    return /гудвин|гуд вин|goodwin/i.test(t)
  })().catch(() => null)
  return Promise.race([job, timeout])
}

function wavHeader(len: number, rate: number) {
  const b = new ArrayBuffer(44)
  const v = new DataView(b)
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF')
  v.setUint32(4, 36 + len, true)
  s(8, 'WAVE')
  s(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  s(36, 'data')
  v.setUint32(40, len, true)
  return b
}
