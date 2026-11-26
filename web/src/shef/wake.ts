// Как распознаватель на устройстве (Vosk) слышит имя ассистента.
// «Гудвин» есть в словаре Vosk и слышится чётко: на замере 12 из 12 фраз, уверенность 0.99, ложных на обычной речи — 0.
// Голос конкретного человека при желании добавляется обучением.
import { getCfg } from './ai'

/** Имя целым словом (с падежами: «Гудвин», «Гудвину»…). */
export const WAKE_WORDS = /(?:^|\s)гудвин\S*(?=\s|$)/

// после смены имени старые выученные фразы (под «Бурмалдец») больше не нужны — они только будили бы зря
try {
  if (!localStorage.getItem('bm:wakeName')) {
    localStorage.setItem('bm:wakeName', 'гудвин')
    const c = JSON.parse(localStorage.getItem('bm:cfg') || 'null')
    if (c?.wakeExtra?.length) localStorage.setItem('bm:cfg', JSON.stringify({ ...c, wakeExtra: [] }))
  }
} catch {
  /* пусто */
}

/** Нижний регистр, без знаков и «ё» — так же, как пишет Vosk. */
export const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Фразы из обучения голосу (что Vosk услышал, когда хозяин звал по имени). */
export const wakeExtra = (): string[] => (getCfg().wakeExtra || []).map(norm).filter(Boolean)

/**
 * Нашли имя? Возвращает, где оно кончается (дальше может идти команда), или -1.
 * final — это законченная реплика (после паузы), а не промежуточный вариант распознавателя.
 * Выученная фраза в одно слово (например «отец») — обычное слово, поэтому будит, только если сказана отдельной
 * репликой («Отец!») или обращением с паузой («Отец, … »); «мой отец сказал» и «отец пришёл домой» — нет.
 */
export type Word = { word: string; start: number; end: number }
/** Пауза после обращения («Отец, … »), в секундах. В обычной речи между словами меньше. */
const ADDRESS_PAUSE = 0.18

export function wakeEnd(text: string, extra = wakeExtra(), final = true, words?: Word[]): number {
  const t = norm(text)
  const m = t.match(WAKE_WORDS)
  if (m) return (m.index || 0) + m[0].length
  for (const p of extra) {
    if (!p.includes(' ')) {
      if (final && t === p) return p.length
      // «Отец, включи музыку»: слово первым и после него пауза-запятая
      if (final && words && words.length > 1 && norm(words[0].word) === p && words[1].start - words[0].end >= ADDRESS_PAUSE) return p.length
    } else {
      const i = (' ' + t + ' ').indexOf(' ' + p + ' ')
      if (i >= 0) return i + p.length
    }
  }
  return -1
}

/** Текст после имени — это команда («Гудвин, включи музыку» → «включи музыку»). */
export const afterWake = (text: string, end: number) => norm(text).slice(end).trim()
