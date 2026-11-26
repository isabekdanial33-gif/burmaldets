// Распознавание речи как на сайте Gemini: модель Google «Gemini 3.5 Transcribe» в потоковом режиме (Live API).
// Звук идёт кусками прямо во время речи; промежуточный текст виден сразу, итог приходит ~0,5 с после конца фразы.
// Работает по ключу Gemini пользователя; без ключа или сети — прежний путь (облако одним запросом или Vosk).
import { getAgents, keyFor } from './ai'
import { listProjects } from './chats'

const URL_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const MODEL = 'models/gemini-3.5-transcribe-live'

export const liveSttReady = () => !!keyFor('gemini') && navigator.onLine

/** Слова-подсказки: имя ассистента, агенты, проекты — их распознаватель пишет правильно. */
function vocabulary(): string[] {
  const v = ['Гудвин', ...getAgents().map((a) => a.name), ...listProjects().map((p) => p.name)]
  return [...new Set(v.map((x) => x.trim()).filter(Boolean))].slice(0, 100)
}

function b64(f: Float32Array): string {
  const buf = new ArrayBuffer(f.length * 2)
  const v = new DataView(buf)
  for (let i = 0; i < f.length; i++) v.setInt16(i * 2, Math.max(-1, Math.min(1, f[i])) * 0x7fff, true)
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

export class LiveStt {
  private ws: WebSocket | null = null
  private ok = false
  private dead = false
  private queue: string[] = []
  private finals = ''
  private interim = ''
  private onFinal: (() => void) | null = null
  /** Соединение готово (или нет) — не дольше 4 секунд. */
  ready: Promise<boolean>

  private onText: (t: string) => void

  constructor(onText: (t: string) => void) {
    this.onText = onText
    this.ready = new Promise((res) => {
      const t = setTimeout(() => (this.fail(), res(false)), 4000)
      try {
        const ws = new WebSocket(`${URL_WS}?key=${encodeURIComponent(keyFor('gemini'))}`)
        this.ws = ws
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              setup: { model: MODEL, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: ['ru-RU'], customVocabulary: vocabulary() } },
            }),
          )
        ws.onmessage = async (e) => {
          let m: { setupComplete?: unknown; serverContent?: { interimInputTranscription?: { text?: string }; inputTranscription?: { text?: string } } }
          try {
            m = JSON.parse(typeof e.data === 'string' ? e.data : await (e.data as Blob).text())
          } catch {
            return
          }
          if (m.setupComplete !== undefined) {
            clearTimeout(t)
            this.ok = true
            for (const q of this.queue) ws.send(q)
            this.queue = []
            res(true)
          }
          const sc = m.serverContent
          if (sc?.interimInputTranscription?.text) {
            this.interim = sc.interimInputTranscription.text
            this.onText((this.finals + ' ' + this.interim).trim())
          }
          if (sc?.inputTranscription?.text) {
            this.finals = (this.finals + ' ' + sc.inputTranscription.text).trim()
            this.interim = ''
            this.onText(this.finals)
            this.onFinal?.()
          }
        }
        ws.onerror = () => (clearTimeout(t), this.fail(), res(false))
        ws.onclose = () => (clearTimeout(t), (this.dead = true), res(this.ok), this.onFinal?.())
      } catch {
        clearTimeout(t)
        this.fail()
        res(false)
      }
    })
  }

  private fail() {
    this.dead = true
    try {
      this.ws?.close()
    } catch {
      /* пусто */
    }
  }

  /** Уже что-то расслышал (даже если наш детектор речи не заметил тихий голос). */
  get any() {
    return !!(this.finals || this.interim)
  }

  get failed() {
    return this.dead && !this.ok
  }

  /** Кусок звука с микрофона (16 кГц, моно). До готовности соединения копим (не больше ~12 с). */
  push(f: Float32Array) {
    if (this.dead) return
    const msg = JSON.stringify({ realtimeInput: { audio: { data: b64(f), mimeType: 'audio/pcm;rate=16000' } } })
    if (this.ok) this.ws!.send(msg)
    else if (this.queue.length < 48) this.queue.push(msg)
  }

  /** Фраза закончилась: просим итог и ждём его (до 2,5 с). Пусто — значит не вышло, пусть решает запасной путь. */
  async end(): Promise<string> {
    if (!(await this.ready) || this.dead) return this.finals
    this.ws!.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
    await new Promise<void>((res) => {
      const t = setTimeout(res, 2500)
      // итог может прийти несколькими кусками — ждём небольшую паузу после последнего
      let quiet = 0
      this.onFinal = () => {
        clearTimeout(quiet)
        quiet = window.setTimeout(() => (clearTimeout(t), res()), 300)
      }
    })
    this.onFinal = null
    const text = (this.finals || this.interim).trim()
    this.close()
    return text
  }

  close() {
    this.dead = true
    try {
      this.ws?.close()
    } catch {
      /* пусто */
    }
  }
}
