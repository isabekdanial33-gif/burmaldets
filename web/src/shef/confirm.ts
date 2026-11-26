// Подтверждение опасных действий: отправить, оплатить, удалить, позвонить, купить...
// Решает КОД: модель может только задать вопрос, а действие выполнится лишь после «да» человека.
import type { Emotion } from './brain'

type Pending = { question: string; run: () => Promise<string>; at: number }
let pending: Pending | null = null

export const RISKY =
  /отправ|send|оплат|pay|купить|покупк|buy|заказ|order|оформ|удал|delete|remove|стере|очист|clear|подтверд|confirm|перев[еоё]д|transfer|позвон|call|вызов|сброс|reset|выйти|выход|logout|sign out|опубликов|publish|post|подпис|subscribe|установ|install|разреш|allow|принять|accept|отключ|disable/i

/** Запомнить действие и вернуть вопрос, который Гудвин задаст человеку. */
export function askConfirm(question: string, run: () => Promise<string>): string {
  pending = { question, run, at: Date.now() }
  return question
}

export const hasConfirm = () => !!pending && Date.now() - pending.at < 120000

const YES = /^(да|ага|угу|давай|конечно|верно|точно|подтверждаю|выполняй|делай|жми|нажимай|отправляй|ок|окей|yes)(\s|$)/
const NO = /^(нет|не надо|не нужно|отмена|отмени|стоп|не отправляй|не жми|no)(\s|$)/

/** Ответ человека на вопрос-подтверждение. null — это не ответ на него. */
export async function answerConfirm(raw: string): Promise<{ text: string; emotion: Emotion } | null> {
  if (!hasConfirm()) {
    pending = null
    return null
  }
  const t = raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/^\s*(?:гудвин\S*|гуд вин|шеф)[\s,]+/, '')
    .trim()
  const p = pending!
  if (NO.test(t)) {
    pending = null
    return { text: 'Хорошо, не делаю.', emotion: 'спокойно' }
  }
  if (YES.test(t)) {
    pending = null
    try {
      return { text: await p.run(), emotion: 'радость' }
    } catch (e) {
      return { text: 'Не получилось: ' + String(e), emotion: 'грусть' }
    }
  }
  return null
}

export const clearConfirm = () => (pending = null)
