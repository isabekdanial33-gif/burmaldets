// Как распознаватель на устройстве (Vosk) слышит имя ассистента.
// «Бурмалдец» ему незнаком, и он подбирает похожие слова: «бур молодец», «бурма отец», «чеку нет»...
// Встроенные варианты ниже проверены на записях; голос конкретного человека добавляется обучением.
import { getCfg } from './ai'

/** Встроенные варианты. Совпадение — только целыми словами. */
export const WAKE_WORDS =
  /(?:^|\s)(?:(?:бур|бор|бура|бурма|бурмал|бурный|бурно)\s+(?:молодец|малец|мальца|молодца|молодцы|отец|дец)|(?:чеку|чику|чека|чекан)\s+(?:нет|нец|конец|нету|отец)|чек\s+отец|бурмалд\S*|чекун\S*)(?=\s|$)/

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

/** Текст после имени — это команда («Бурмалдец, включи музыку» → «включи музыку»). */
export const afterWake = (text: string, end: number) => norm(text).slice(end).trim()
