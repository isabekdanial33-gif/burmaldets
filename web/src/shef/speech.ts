// Голос Бурмалдеца. Говорит: готовые фразы (заранее озвучены голосом Gemini) → выбранный голос (Gemini / OpenAI / Edge) → голос системы.
// Слушает: на телефоне — нативное распознавание; в браузере — Web Speech API; в приложении для компьютера — desk.ts.
import { getCfg, keyFor, setCfg, type VoiceEngine } from './ai'
import { isAndroid, nativeCall, onNative } from './bridge'
import { tts, ttsOpenAI } from './llm'
import { desk, isDesktop } from './net'
import { deskCancel, deskListen, deskWake, stopDeskWake } from './desk'

/** Громкость текущей речи 0..1 — по ней желешка открывает рот. */
export const level = { value: 0 }

/** Каким голосом говорить на самом деле: «авто» — лучший из доступных по ключам. */
export function voiceEngine(): Exclude<VoiceEngine, 'auto'> {
  const v = getCfg().voice
  if (v === 'gemini' && keyFor('gemini')) return 'gemini'
  if (v === 'openai' && keyFor('openai')) return 'openai'
  if (v === 'edge' && isDesktop) return 'edge'
  if (v === 'system') return 'system'
  if (keyFor('gemini')) return 'gemini'
  if (keyFor('openai') && getCfg().provider === 'openai') return 'openai'
  return 'system'
}
export const getVoiceEngine = () => getCfg().voice
export const setVoiceEngine = (v: VoiceEngine) => setCfg({ voice: v, voiceName: '' })
export const getVoiceName = () => getCfg().voiceName || (voiceEngine() === 'openai' ? 'onyx' : voiceEngine() === 'edge' ? 'ru-RU-DmitryNeural' : 'Achird')
export const setVoiceName = (v: string) => setCfg({ voiceName: v })
export const OPENAI_VOICES = [
  ['onyx', 'Onyx — низкий мужской'],
  ['ash', 'Ash — спокойный мужской'],
  ['echo', 'Echo — мужской'],
  ['verse', 'Verse — живой мужской'],
  ['nova', 'Nova — женский'],
  ['shimmer', 'Shimmer — мягкий женский'],
]
export const EDGE_VOICES = [
  ['ru-RU-DmitryNeural', 'Дмитрий — мужской'],
  ['ru-RU-SvetlanaNeural', 'Светлана — женский'],
]
export const GEMINI_VOICES = [
  ['Achird', 'Achird — дружелюбный мужской'],
  ['Algieba', 'Algieba — мягкий бархатный мужской'],
  ['Umbriel', 'Umbriel — спокойный мужской'],
  ['Iapetus', 'Iapetus — чёткий мужской'],
  ['Charon', 'Charon — деловой мужской'],
  ['Sulafat', 'Sulafat — тёплый женский'],
  ['Vindemiatrix', 'Vindemiatrix — нежный женский'],
  ['Despina', 'Despina — плавный женский'],
  ['Achernar', 'Achernar — мягкий женский'],
]

// ---------- готовые фразы ----------
let canned: Record<string, string> | null = null
const cannedReady = fetch(`${import.meta.env.BASE_URL}shef/voice/index.json`)
  .then((r) => (r.ok ? r.json() : {}))
  .then((j: Record<string, string>) => (canned = j))
  .catch(() => (canned = {}))
const key = (t: string) => t.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim()

// ---------- воспроизведение с анализатором (для рта) ----------
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let current: HTMLAudioElement | null = null
let stopped = 0

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}
/** Вызывать из обработчика нажатия: браузеру нужен жест, чтобы разрешить звук. */
export const unlockAudio = () => {
  try {
    ensureCtx()
  } catch {
    /* нет WebAudio */
  }
}

let raf = 0
function meter() {
  cancelAnimationFrame(raf)
  const buf = new Uint8Array(256)
  const tick = () => {
    if (analyser && current && !current.paused) {
      analyser.getByteTimeDomainData(buf)
      let s = 0
      for (const v of buf) s += ((v - 128) / 128) ** 2
      level.value = Math.min(1, Math.sqrt(s / buf.length) * 4)
      raf = requestAnimationFrame(tick)
    } else level.value = 0
  }
  raf = requestAnimationFrame(tick)
}

/** Ночной режим: с 23:00 до 7:00 Бурмалдец говорит тише (как Алиса). Выключается в настройках. */
const NIGHT_KEY = 'shef:night'
export const getNight = () => {
  try {
    return localStorage.getItem(NIGHT_KEY) !== '0'
  } catch {
    return true
  }
}
export const setNight = (on: boolean) => {
  try {
    localStorage.setItem(NIGHT_KEY, on ? '1' : '0')
  } catch {
    /* пусто */
  }
}
/** Скорость речи: «говори быстрее/медленнее/нормально» (0.7–1.5). */
const RATE_KEY = 'shef:rate'
export const getRate = () => {
  try {
    const r = Number(localStorage.getItem(RATE_KEY))
    return r >= 0.6 && r <= 1.6 ? r : 1
  } catch {
    return 1
  }
}
export const setRate = (r: number) => {
  const v = Math.round(Math.min(1.5, Math.max(0.7, r)) * 100) / 100
  try {
    localStorage.setItem(RATE_KEY, String(v))
  } catch {
    /* пусто */
  }
  return v
}

export function nightVolume() {
  const h = new Date().getHours()
  return getNight() && (h >= 23 || h < 7) ? 0.4 : 1
}

function playBlob(src: string, keepRate = false): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(src)
    a.volume = nightVolume()
    a.playbackRate = keepRate ? 1 : getRate()
    current = a
    try {
      const c = ensureCtx()
      c.createMediaElementSource(a).connect(analyser!)
    } catch {
      /* без анализатора — рот будет двигаться «на глаз» */
    }
    a.onended = a.onerror = a.onpause = () => {
      level.value = 0
      resolve()
    }
    a.play().then(meter, () => resolve())
  })
}

// ---------- голос системы ----------
let sysVoice: SpeechSynthesisVoice | null = null
function pickSysVoice() {
  if (sysVoice || !('speechSynthesis' in window)) return sysVoice
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'))
  const pref = [/svetlana.*natural|dmitry.*natural/i, /natural|online/i, /google/i, /milena|yuri/i, /irina|pavel/i]
  for (const re of pref) {
    const v = vs.find((x) => re.test(x.name))
    if (v) return (sysVoice = v)
  }
  return (sysVoice = vs[0] || null)
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => ((sysVoice = null), pickSysVoice())

/** Ударения и произношение, которые часто ломают синтезаторы. */
const FIX: [RegExp, string][] = [
  [/°\s?C/g, ' градусов'],
  [/(\d)\s?мин(?![а-яёa-z0-9])\.?/gi, '$1 минут'],
  [/(\d)\s?ч(?![а-яёa-z0-9])\.?/gi, '$1 часов'],
  [/(\d)\s?г(?![а-яёa-z0-9])\.?/gi, '$1 грамм'],
  [/(\d)\s?мл(?![а-яёa-z0-9])\.?/gi, '$1 миллилитров'],
  [/(\d)\s?кг(?![а-яёa-z0-9])\.?/gi, '$1 килограмм'],
  [/ч\.\s?л\./g, 'чайная ложка'],
  [/ст\.\s?л\./g, 'столовая ложка'],
  [/ГрандШеф\S*/gi, 'Гранд Шеф'],
  // своё имя: синтезаторы (особенно Gemini) смазывают конечное «ц» до «с» — «тс» звучит как чёткое «ц» (проверено по спектрограммам)
  [/(бурмалде|чекуне)ц(?![а-яё])/gi, '$1тс'],
  [/(?<![а-яёa-z0-9])ккал(?![а-яёa-z0-9])\.?/gi, 'килокалорий'],
  [/(?<![а-яёa-z0-9])кбжу(?![а-яёa-z0-9])/gi, 'калории, белки, жиры и углеводы'],
  [/\*(\d)(\d)(\d)(\d)\b/g, 'на конце $1 $2 $3 $4'],
  [/(\d)\s?%/g, '$1 процентов'],
  [/(\d)\s?₸/g, '$1 тенге'],
  [/\$\s?(\d[\d\s]*\d|\d)/g, '$1 долларов'],
  [/(\d)\s?€/g, '$1 евро'],
  [/(?<![\d:])0(\d):(\d\d)(?!\d)/g, '$1:$2'],
]
export const speakable = (t: string) => FIX.reduce((s, [re, to]) => s.replace(re, to), t)

function systemSay(text: string): Promise<void> {
  if (isAndroid) {
    return nativeCall('speak', { text, volume: nightVolume(), rate: getRate() }, 120000).then(
      () => {},
      () => {},
    )
  }
  if (!('speechSynthesis' in window)) return Promise.resolve()
  return new Promise((resolve) => {
    // некоторые браузеры не присылают «договорил» — страхуемся по длине текста
    const guard = window.setTimeout(() => {
      level.value = 0
      resolve()
    }, 2500 + text.length * 110)
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ru-RU'
    const v = pickSysVoice()
    if (v) u.voice = v
    u.rate = 1.02 * getRate()
    u.volume = nightVolume()
    let pulse = 0
    u.onboundary = () => {
      level.value = 0.7
      clearTimeout(pulse)
      pulse = window.setTimeout(() => (level.value = 0.15), 140)
    }
    u.onend = u.onerror = () => {
      clearTimeout(guard)
      level.value = 0
      resolve()
    }
    speechSynthesis.speak(u)
  })
}
if (isAndroid) onNative('tts-level', (d) => (level.value = Number(d) || 0))

const ttsCache = new Map<string, Promise<Blob>>()
const b64blob = (b: string, type: string) => new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type })
const edgeAudio = (t: string, v: string) =>
  (desk!.tts as (t: string, v: string, rate: number) => Promise<{ b64?: string; error?: string }>)(t, v, 1).then((r) => {
    if (!r.b64) throw new Error(r.error || 'edge')
    return b64blob(r.b64, 'audio/mpeg')
  })
const engineAudio = (t: string): Promise<Blob> => {
  const e = voiceEngine()
  const v = getVoiceName()
  if (e === 'edge') return edgeAudio(t, /^ru-RU-/.test(v) ? v : 'ru-RU-DmitryNeural')
  const p = e === 'openai' ? ttsOpenAI(t, v) : tts(t, v)
  return p
}
const geminiAudio = (t: string) => {
  const k = voiceEngine() + getVoiceName() + '|' + t
  if (!ttsCache.has(k)) {
    const p = engineAudio(t)
    p.catch(() => ttsCache.delete(k))
    ttsCache.set(k, p)
    if (ttsCache.size > 60) ttsCache.delete(ttsCache.keys().next().value!)
  }
  return ttsCache.get(k)!
}

/** Разбиваем на куски по предложениям, но не слишком мелко: каждый кусок — отдельный запрос. */
function chunks(t: string): string[] {
  const sents = t.match(/[^.!?…]+[.!?…]*\s*/g) || [t]
  const out: string[] = []
  let cur = ''
  for (const s of sents) {
    // первый кусок — одна короткая фраза: её озвучка готова быстрее всего, Бурмалдец начинает говорить почти сразу
    if (cur && (out.length === 0 || (cur + s).length > 260)) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Если Gemini-голос недавно тормозил — какое-то время говорим голосом устройства сразу, без ожидания. */
let geminiSlowUntil = 0
const FIRST_WAIT = 5000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('slow')), ms))])
}

/** onStart — звук пошёл (тогда и показываем текст, чтобы субтитры не убегали вперёд голоса). */
export async function say(text: string, onStart?: () => void): Promise<void> {
  stopSpeaking()
  const my = ++stopped
  const t = text.trim()
  let started = false
  const go = () => {
    if (!started && my === stopped) {
      started = true
      onStart?.()
    }
  }
  try {
    return await sayInner(t, my, go)
  } finally {
    go()
  }
}

async function sayInner(t: string, my: number, go: () => void): Promise<void> {
  if (!t) return
  await withTimeout(cannedReady, 1500).catch(() => {})
  if (my !== stopped) return
  // готовые фразы записаны голосом Gemini Achird — звучат, только если выбран он же
  const c = voiceEngine() === 'gemini' && getVoiceName() === 'Achird' ? canned?.[key(t)] : undefined
  if (c) {
    go()
    return playBlob(`${import.meta.env.BASE_URL}shef/voice/${c}`)
  }
  const spoken = speakable(t)
  if (voiceEngine() !== 'system' && navigator.onLine && Date.now() > geminiSlowUntil) {
    const parts = chunks(spoken)
    const jobs = parts.map((p, i) => (i < 2 ? geminiAudio(p) : null))
    let i = 0
    try {
      for (; i < parts.length; i++) {
        if (my !== stopped) return
        // ждём звук не дольше нескольких секунд — иначе Бурмалдец заговорит через минуту, невпопад
        const blob = await withTimeout(jobs[i] || geminiAudio(parts[i]), i === 0 ? FIRST_WAIT : 9000)
        if (i + 2 < parts.length) jobs[i + 2] = geminiAudio(parts[i + 2]) // следующий кусок готовится, пока играет этот
        if (my !== stopped) return
        const url = URL.createObjectURL(blob)
        go()
        await playBlob(url)
        URL.revokeObjectURL(url)
      }
      return
    } catch (e) {
      if (my !== stopped) return
      if (e instanceof Error && e.message === 'slow') geminiSlowUntil = Date.now() + 5 * 60000
      // лимит, сеть или медленно — дочитываем голосом устройства то, что ещё не прозвучало
      go()
      return systemSay(parts.slice(i).join(' '))
    }
  }
  go()
  return systemSay(spoken)
}

export function stopSpeaking() {
  stopped++
  if (current) {
    current.pause()
    current = null
  }
  level.value = 0
  if (isAndroid) nativeCall('stopSpeak', {}, 3000).catch(() => {})
  else if ('speechSynthesis' in window) speechSynthesis.cancel()
}

// ---------- распознавание ----------
type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
const RecCtor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ||
  (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition
export const canHear = isAndroid || isDesktop || !!RecCtor

/** Громкость микрофона 0..1, пока Бурмалдец слушает (на телефоне — от распознавателя). */
export const micLevel = { value: 0 }
if (isAndroid) onNative('stt-level', (d) => (micLevel.value = Number(d) || 0))

/** Короткий мягкий сигнал «говорите» — как у голосовых помощников. */
export function chime(up = true): Promise<void> {
  try {
    const c = ensureCtx()
    const t = c.currentTime + 0.02
    const g = c.createGain()
    g.connect(c.destination)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
    for (const [f, d] of up ? [[660, 0], [990, 0.09]] : [[880, 0], [587, 0.09]]) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(f, t + d)
      o.connect(g)
      o.start(t + d)
      o.stop(t + d + 0.25)
    }
    return new Promise((r) => setTimeout(r, 300))
  } catch {
    return Promise.resolve()
  }
}

export type Heard = { text: string; how: string }

let cancelCurrent: (() => void) | null = null
/** Прервать слушание (человек начал печатать или нажал на Бурмалдеца). */
export function cancelListen() {
  cancelCurrent?.()
}

/** Одна фраза. onPartial — промежуточный текст для субтитров. Пустой text — тишина (how — почему). */
export function listen(onPartial?: (t: string) => void): Promise<Heard> {
  const cancelled = new Promise<Heard>((res) => {
    cancelCurrent = () => {
      cancelCurrent = null
      if (isAndroid) nativeCall('cancelListen', {}, 3000).catch(() => {})
      else if (isDesktop) deskCancel()
      else curRec?.abort()
      res({ text: '', how: 'cancel' })
    }
  })
  return Promise.race([listenInner(onPartial), cancelled]).finally(() => (cancelCurrent = null))
}

let curRec: Rec | null = null
function listenInner(onPartial?: (t: string) => void): Promise<Heard> {
  if (isAndroid) {
    let last = ''
    const off = onNative('stt-partial', (d) => {
      const p = String(d || '')
      if (p.trim()) last = p
      onPartial?.(p)
    })
    return nativeCall<{ text?: string; how?: string }>('listen', {}, 45000)
      .then((r) => ({ text: (r.text || last).trim(), how: r.how || '' }))
      .catch((e) => ({ text: last.trim(), how: 'мост: ' + String(e?.message || e) }))
      .finally(() => {
        off()
        micLevel.value = 0
      })
  }
  if (isDesktop) return deskListen(onPartial, micLevel)
  if (!RecCtor) return Promise.resolve({ text: '', how: 'нет распознавания в браузере' })
  const started = Date.now()
  const once = (): Promise<Heard> =>
    new Promise((resolve) => {
      const r = new RecCtor()
      curRec = r
      r.lang = 'ru-RU'
      r.continuous = false
      r.interimResults = true
      let fin = ''
      let interim = ''
      let err = ''
      let done = false
      const end = () => {
        if (done) return
        done = true
        clearTimeout(t)
        micLevel.value = 0
        // браузер иногда обрывает без «финала» — тогда берём черновик, а не тишину
        resolve({ text: (fin || interim).trim(), how: err || 'browser' })
      }
      const t = setTimeout(() => r.stop(), 12000)
      r.onresult = (e) => {
        interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const tr = e.results[i][0].transcript
          if (e.results[i].isFinal) fin += tr
          else interim += tr
        }
        micLevel.value = 0.8
        setTimeout(() => (micLevel.value = 0.2), 150)
        onPartial?.((fin + interim).trim())
      }
      r.onerror = (e) => {
        err = e.error
        end()
      }
      r.onend = () => end()
      try {
        r.start()
      } catch (e) {
        err = 'start: ' + String(e)
        end()
      }
    })
  return (async () => {
    let h = await once()
    // «aborted»/«no-speech» сразу после старта — микрофон ещё занят фоновым слушанием, пробуем снова
    for (let k = 0; k < 2 && !h.text && Date.now() - started < 4000 && h.how !== 'not-allowed' && h.how !== 'aborted'; k++) {
      await new Promise((r) => setTimeout(r, 300))
      h = await once()
    }
    return h
  })()
}

// ---------- слово «Бурмалдец» на компьютере ----------
const WAKE = /(^|\s)(бурмалд[а-яё]*|бурмал[а-яё]*|бур малец|бур молодец|бор молодец|чекун[а-яё]*|чекунес|чеку нет|чеку конец)(?=\s|$|[,.!?])/i
let wakeRec: Rec | null = null
let wakeOn = false
/**
 * Слушает фоном, пока открыта вкладка. «Бурмалдец» → onWake(''), «Бурмалдец, включи музыку» → onWake('включи музыку').
 * На телефоне это делает служба приложения (даже при выключенном экране) — тут не нужно.
 */
export function startWake(onWake: (rest: string) => void) {
  if (isDesktop) return void deskWake(onWake)
  if (isAndroid || !RecCtor || wakeOn) return
  wakeOn = true
  const run = () => {
    if (!wakeOn) return
    const r = new RecCtor()
    wakeRec = r
    r.lang = 'ru-RU'
    r.continuous = true
    r.interimResults = true
    let fired = false
    let restText = ''
    let timer = 0
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript
        const m = tr.match(WAKE)
        if (!m) continue
        const rest = tr.slice((m.index || 0) + m[0].length).replace(/^[\s,.!?]+/, '')
        restText = rest
        if (!fired) {
          fired = true
          // ждём чуть-чуть: вдруг команда сказана сразу за словом «Бурмалдец»
          timer = window.setTimeout(() => r.stop(), e.results[i].isFinal ? 0 : 900)
        }
        if (e.results[i].isFinal) {
          clearTimeout(timer)
          r.stop()
        }
      }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wakeOn = false
    }
    r.onend = () => {
      wakeRec = null
      if (fired) {
        wakeOn = false
        onWake(restText.trim())
      } else if (wakeOn) setTimeout(run, 250)
    }
    try {
      r.start()
    } catch {
      setTimeout(run, 1000)
    }
  }
  run()
}
export function stopWake() {
  if (isDesktop) stopDeskWake()
  wakeOn = false
  wakeRec?.abort()
  wakeRec = null
}
export const wakeActive = () => wakeOn
