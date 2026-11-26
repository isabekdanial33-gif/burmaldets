// Слух Гудвина в приложении для компьютера (Electron): там нет распознавания Google из браузера.
// Слово «Гудвин» ловит Vosk прямо на компьютере (звук никуда не уходит).
// Команду после него — облачное распознавание по вашему ключу (Groq/OpenAI Whisper или Gemini), без ключа — тоже Vosk.
import type { KaldiRecognizer, Model } from 'vosk-browser'
import { cloudStt, transcribe, verifyName } from './llm'
import { LiveStt, liveSttReady } from './livestt'
import { desk, isDesktop } from './net'
import { afterWake, wakeEnd, norm, WAKE_WORDS } from './wake'

type WordConf = { word: string; start: number; end: number; conf: number }
/** Минимальная уверенность Vosk в словах имени (0..1). */
const MIN_CONF = 0.6
/** Уверенность в словах, из которых сложилось имя (последние до конца совпадения, не больше трёх). */
function nameConf(text: string, end: number, words?: WordConf[]) {
  if (!words?.length) return 1
  // слова Vosk идут ровно как в тексте: имя — последние слова до конца совпадения
  const upto = norm(text).slice(0, end).split(' ').filter(Boolean)
  const k = Math.min(words.length, upto.length)
  // имя — одно слово; выученная фраза бывает из двух
  const take = k >= 2 && !/^гудвин/.test(upto[upto.length - 1]) ? 2 : 1
  return words.slice(Math.max(0, k - take), k).reduce((m, w) => Math.min(m, w.conf ?? 1), 1)
}

type Level = { value: number }
/** Короткий журнал слуха (для отладки): window.__bmEar */
const ear = ((window as unknown as { __bmEar?: string[] }).__bmEar = [] as string[])
const note = (t: string) => (ear.push(new Date().toISOString().slice(14, 23) + ' ' + t), ear.length > 60 && ear.shift())
type Heard = { text: string; how: string }

let modelP: Promise<Model> | null = null
function model() {
  if (!modelP)
    modelP = import('vosk-browser').then(({ createModel }) => createModel(new URL('vosk/model.tar.gz', location.href).href, -1)).catch((e) => {
      modelP = null
      throw e
    })
  return modelP
}

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let proc: ScriptProcessorNode | null = null
let sink: ((buf: Float32Array) => void) | null = null
const RATE = 16000

let offTimer = 0
async function mic() {
  clearTimeout(offTimer)
  if (stream && ctx) return
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  ctx = new AudioContext({ sampleRate: RATE })
  const src = ctx.createMediaStreamSource(stream)
  proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (e) => sink?.(e.inputBuffer.getChannelData(0).slice())
  src.connect(proc)
  // ScriptProcessor работает, только если подключён к выходу — даём ему «немой» выход
  const mute = ctx.createGain()
  mute.gain.value = 0
  proc.connect(mute).connect(ctx.destination)
}
/** Микрофон закрываем не сразу: в разговоре следующая реплика начнётся без задержки на включение. */
function micOffSoon() {
  clearTimeout(offTimer)
  offTimer = window.setTimeout(() => !wakeOn && !listening && micOff(), 12000)
}
function micOff() {
  sink = null
  proc?.disconnect()
  proc = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  ctx?.close().catch(() => {})
  ctx = null
}

const rms = (b: Float32Array) => {
  let s = 0
  for (let i = 0; i < b.length; i++) s += b[i] * b[i]
  return Math.sqrt(s / b.length)
}

// ---------- слово-активатор ----------
let wakeOn = false
let wakeRec: KaldiRecognizer | null = null
let wakeCb: ((rest: string) => void) | null = null

export async function deskWake(onWake: (rest: string) => void) {
  if (!isDesktop) return
  wakeCb = onWake
  if (wakeOn) return
  wakeOn = true
  try {
    const m = await model()
    await mic()
    if (!wakeOn) return
    const rec = new m.KaldiRecognizer(RATE)
    rec.setWords(true)
    wakeRec = rec
    // звук текущей фразы — для облачной перепроверки имени (не больше 12 секунд)
    let utt: Float32Array[] = []
    let checking = false
    const fire = async (text: string, words?: WordConf[]) => {
      const end = wakeEnd(text, undefined, true, words)
      if (end < 0) return false
      // уверенность распознавателя в словах имени: невнятное «бур… молод…» не будит
      const conf = nameConf(text, end, words)
      note(`кандидат: ${text} (уверенность ${conf.toFixed(2)})`)
      if (conf < MIN_CONF) {
        note('отклонено: нечётко')
        return false
      }
      // чёткое «Гудвин» будит сразу; сомнительное (уверенность ниже 0.9 или выученная фраза) — только если облако подтвердит
      let ok: boolean | null = null
      const sure = conf >= 0.9 && WAKE_WORDS.test(norm(text))
      if (!sure && cloudStt()) {
        checking = true
        ok = await verifyName(toWav(utt), 5000).catch(() => null)
        checking = false
        if (ok !== true) {
          note(ok === false ? 'отклонено облаком: не имя' : 'отклонено: облако не подтвердило')
          return false
        }
      }
      if (!wakeOn || wakeRec !== rec) return false
      note('wake: ' + text + (ok ? ' (облако: да)' : ''))
      const rest = afterWake(text, end)
      stopDeskWake()
      // позвали по имени — показываем панель у шара
      void (desk!.call as (m: string, a: object) => Promise<unknown>)('showPanel', {})
      // команда сразу за именем — если её хватает (от двух слов), иначе спросим отдельно
      wakeCb?.(rest.split(' ').length >= 2 ? rest : '')
      return true
    }
    // будим только по законченной фразе (после паузы), а не по промежуточной догадке распознавателя
    rec.on('result', (msg) => {
      const r = (msg as { result: { text: string; result?: WordConf[] } }).result
      const t = r.text || ''
      const audio = utt
      utt = []
      if (t && !checking) {
        utt = audio // для проверки нужен звук именно этой фразы
        void fire(t, r.result).finally(() => (utt = []))
      }
    })
    sink = (b) => {
      if (wakeRec !== rec) return
      if (!checking) {
        utt.push(b)
        if (utt.length > 48) utt.shift() // ~12 с
      }
      rec.acceptWaveformFloat(b, RATE)
    }
    console.info('[bm] wake ready')
  } catch (e) {
    wakeOn = false
    console.warn('[bm] wake', e)
  }
}
export function stopDeskWake() {
  wakeOn = false
  if (wakeRec) {
    try {
      wakeRec.remove()
    } catch {
      /* пусто */
    }
  }
  wakeRec = null
  if (!listening) micOffSoon()
}
export const deskWakeActive = () => wakeOn

// ---------- одна фраза ----------
let listening = false
let cancelFn: (() => void) | null = null
export const deskCancel = () => cancelFn?.()

/** voskOnly — только распознаватель на компьютере (для обучения голосу: нужно ровно то, что слышит слово-активатор). */
export function deskListen(onPartial: ((t: string) => void) | undefined, level: Level, voskOnly = false): Promise<Heard> {
  return new Promise((resolve) => {
    ;(async () => {
      listening = true
      let rec: KaldiRecognizer | null = null
      const frames: Float32Array[] = []
      let done = false
      let voskText = ''
      let partial = ''
      // главный распознаватель — как на сайте Gemini: потоковый Gemini 3.5 Transcribe (если есть ключ Gemini)
      const live = !voskOnly && liveSttReady() ? new LiveStt((t) => onPartial?.(t)) : null
      const finish = async (how: string) => {
        if (done) return
        done = true
        note(`finish ${how} speech=${speech} frames=${frames.length}`)
        clearTimeout(maxT)
        sink = null
        level.value = 0
        cancelFn = null
        listening = false
        // ждём финал Vosk (он нужен, если нет облачного распознавания)
        if (rec) {
          const r = rec
          await new Promise<void>((ok) => {
            const t = setTimeout(ok, 700)
            r.on('result', () => (clearTimeout(t), ok()))
            r.retrieveFinalResult()
          })
          try {
            r.remove()
          } catch {
            /* пусто */
          }
        }
        if (!wakeOn) micOffSoon()
        if (how === 'cancel' || !speech) {
          live?.close()
          return resolve({ text: '', how: how === 'cancel' ? 'cancel' : 'тишина' })
        }
        let text = ''
        if (live) {
          text = await live.end().catch(() => '')
          if (text) how = 'gemini-transcribe'
        }
        // запасной путь: облако одним запросом (ждём его, а не слабый Vosk), потом уже Vosk
        if (!text && cloudStt() && !voskOnly) {
          try {
            text = await Promise.race([transcribe(toWav(frames)), new Promise<string>((_, no) => setTimeout(() => no(new Error('slow')), 10000))])
            how = 'cloud'
          } catch (e) {
            console.warn('[bm] stt', e)
          }
        }
        if (!text) {
          text = voskText || partial
          how = 'vosk'
        }
        note(`text(${how}): ${text.slice(0, 60)}`)
        resolve({ text: text.trim(), how })
      }
      cancelFn = () => finish('cancel')
      let speech = false
      let silence = 0
      let floor = 0.004
      const started = Date.now()
      const maxT = window.setTimeout(() => finish('max'), 14000)
      try {
        await mic()
        const m = await model().catch(() => null)
        if (m) {
          rec = new m.KaldiRecognizer(RATE)
          rec.on('partialresult', (msg) => {
            const p = (msg as { result: { partial: string } }).result.partial
            if (p) {
              partial = (voskText + ' ' + p).trim()
              if ((!cloudStt() && !live) || voskOnly) onPartial?.(partial)
            }
          })
          rec.on('result', (msg) => {
            const t = (msg as { result: { text: string } }).result.text
            if (t) voskText = (voskText + ' ' + t).trim()
          })
        }
      } catch (e) {
        resolve({ text: '', how: 'нет микрофона: ' + String(e) })
        listening = false
        return
      }
      if (cloudStt() && !voskOnly) onPartial?.('')
      note('listen start')
      let nb = 0
      sink = (b) => {
        if (done) return
        if (++nb === 1) note('first audio')
        frames.push(b)
        live?.push(b)
        rec?.acceptWaveformFloat(b, RATE)
        const v = rms(b)
        level.value = Math.min(1, v * 12)
        const sec = b.length / RATE
        if (!speech) {
          floor = floor * 0.9 + v * 0.1
          if (v > Math.max(0.012, floor * 3)) {
            speech = true
            note('speech ' + v.toFixed(3))
          }
          // ни слова за 6 секунд — тишина
          else if (Date.now() - started > 6000) finish('тишина')
          // держим в буфере только последние полсекунды до начала речи
          if (!speech && frames.length > 3) frames.shift()
          return
        }
        silence = v < Math.max(0.01, floor * 2.2) ? silence + sec : 0
        if (silence > 1.1) finish('пауза')
      }
    })()
  })
}

function toWav(frames: Float32Array[]): Blob {
  const n = frames.reduce((s, f) => s + f.length, 0)
  const b = new ArrayBuffer(44 + n * 2)
  const v = new DataView(b)
  const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  let o = 44
  for (const f of frames)
    for (let i = 0; i < f.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, f[i])) * 0x7fff, true)
  return new Blob([b], { type: 'audio/wav' })
}
