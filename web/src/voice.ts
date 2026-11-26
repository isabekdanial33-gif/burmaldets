// Голосовое управление режимом готовки (Web Speech API, ru-RU) и озвучка шагов (speechSynthesis).
// Микрофон включается только явной кнопкой; если браузер не умеет распознавание — кнопка не показывается.
import { useCallback, useEffect, useRef, useState } from 'react'

type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecCtor = new () => Rec

const Ctor: RecCtor | undefined =
  typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition) : undefined

export const canListen = !!Ctor
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

export type Command = { kind: 'next' } | { kind: 'prev' } | { kind: 'repeat' } | { kind: 'timer'; seconds?: number } | { kind: 'stop' }

const NUM_WORDS: Record<string, number> = {
  полторы: 1.5, полтора: 1.5, одну: 1, одна: 1, один: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, полчаса: 30, час: 60,
}

/** «таймер на 5 минут», «таймер десять минут», «таймер полчаса» → секунды. */
function parseDuration(s: string): number | undefined {
  if (/полчаса/.test(s)) return 1800
  const m = s.match(/(\d+(?:[.,]\d+)?|[а-яё]+)\s*(час|ч\b|минут|мин|секунд|сек)/)
  if (!m) return /\bчас\b/.test(s) ? 3600 : undefined
  const n = /\d/.test(m[1]) ? parseFloat(m[1].replace(',', '.')) : NUM_WORDS[m[1]]
  if (!n) return undefined
  return Math.round(n * (m[2].startsWith('ч') ? 3600 : m[2].startsWith('с') ? 1 : 60))
}

/** Разбор фразы в команду. Слова — самые естественные на кухне. */
export function parseCommand(raw: string): Command | null {
  const s = raw.toLowerCase().replace(/ё/g, 'е').trim()
  if (/таймер|засеки|засечь/.test(s)) return { kind: 'timer', seconds: parseDuration(s) }
  if (/(^|\s)(дальше|далее|вперед|следующ|некст|го)(\s|$)/.test(s) || /^(дальше|далее|следующий)/.test(s)) return { kind: 'next' }
  if (/(^|\s)(назад|предыдущ|вернись|обратно)/.test(s)) return { kind: 'prev' }
  if (/повтори|еще раз|прочитай|прочти|что дальше делать|не расслышал/.test(s)) return { kind: 'repeat' }
  if (/(^|\s)(стоп|хватит|замолчи|тихо)(\s|$)/.test(s)) return { kind: 'stop' }
  return null
}

let voice: SpeechSynthesisVoice | null | undefined
function ruVoice() {
  if (voice !== undefined && voice !== null) return voice
  const list = window.speechSynthesis.getVoices()
  voice = list.find((v) => v.lang === 'ru-RU' && /google|милена|milena|irina|ирина/i.test(v.name)) || list.find((v) => v.lang.startsWith('ru')) || null
  return voice
}

export function speak(text: string, onEnd?: () => void) {
  if (!canSpeak) return
  const ss = window.speechSynthesis
  ss.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/°C/g, ' градусов').replace(/\bмин\b/g, 'минут'))
  u.lang = 'ru-RU'
  const v = ruVoice()
  if (v) u.voice = v
  u.rate = 1
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  ss.speak(u)
}
export const stopSpeaking = () => canSpeak && window.speechSynthesis.cancel()

/**
 * Слушает команды, пока on = true. Chrome сам останавливает распознавание после паузы —
 * перезапускаем. Пока идёт озвучка, распознанное игнорируем, чтобы не реагировать на свой же голос.
 */
export function useVoiceCommands(onCommand: (c: Command, heard: string) => void) {
  const [on, setOn] = useState(false)
  const [heard, setHeard] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Rec | null>(null)
  const want = useRef(false)
  const cb = useRef(onCommand)
  useEffect(() => {
    cb.current = onCommand
  }, [onCommand])

  const stop = useCallback(() => {
    want.current = false
    setOn(false)
    try {
      rec.current?.abort()
    } catch {
      /* уже остановлен */
    }
    rec.current = null
  }, [])

  const start = useCallback(() => {
    if (!Ctor) return
    setError(null)
    const r = new Ctor()
    r.lang = 'ru-RU'
    r.continuous = true
    r.interimResults = false
    r.maxAlternatives = 3
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (!res.isFinal) continue
        if (canSpeak && window.speechSynthesis.speaking) continue
        const alts = Array.from({ length: res.length }, (_, k) => res[k].transcript)
        setHeard(alts[0] || '')
        for (const a of alts) {
          const c = parseCommand(a)
          if (c) {
            cb.current(c, a)
            break
          }
        }
      }
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Нет доступа к микрофону — разрешите его в настройках браузера')
        stop()
      } else if (e.error === 'network') {
        setError('Распознавание речи требует интернет')
        stop()
      }
      // no-speech / aborted — штатно, onend перезапустит
    }
    r.onend = () => {
      if (want.current && rec.current === r) {
        try {
          r.start()
        } catch {
          /* перезапуск не удался — выключаем */
          stop()
        }
      }
    }
    rec.current = r
    want.current = true
    try {
      r.start()
      setOn(true)
    } catch {
      setError('Не удалось включить микрофон')
      want.current = false
    }
  }, [stop])

  useEffect(() => stop, [stop])
  return { on, heard, error, start, stop, toggle: () => (want.current ? stop() : start()) }
}
