// Контакты и звонки. Номера не уходят в Gemini — имена сравниваются здесь, на устройстве.
// Звонок — ТОЛЬКО после явного «да» пользователя: Бурмалдец сначала спрашивает, кому именно звонить.
import { isAndroid, nativeCall } from './bridge'

export type Contact = { name: string; number: string; starred?: boolean; times?: number }

let cache: { at: number; list: Contact[] } | null = null

export async function getContacts(): Promise<{ list: Contact[]; error?: string }> {
  if (!isAndroid) return { list: [], error: 'pc' }
  if (cache && Date.now() - cache.at < 5 * 60000) return { list: cache.list }
  const r = await nativeCall<{ ok?: boolean; contacts?: Contact[]; error?: string }>('contacts', {}, 60000).catch((e) => ({ ok: false, error: String(e), contacts: [] }))
  if (!r.ok) return { list: [], error: r.error === 'denied' ? 'denied' : r.error || 'error' }
  cache = { at: Date.now(), list: r.contacts || [] }
  return { list: cache.list }
}

/** «Мама ❤️», «МАМА», «мамочка» → «мама»: регистр, ё, смайлики и знаки не важны. */
export const cleanName = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Основа слова без падежного окончания: «маме», «мамой» → «мам», «бабушке» → «бабушк», «брату» → «брат». */
const stem = (w: string) => (w.length > 3 ? w.replace(/[аяоеиыуюйьэ]{1,2}$/, '') : w)

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
const latin = (s: string) => [...s].map((c) => TR[c] ?? c).join('')

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

function wordScore(q: string, n: string): number {
  if (q === n) return 100
  const qs = stem(q)
  const ns = stem(n)
  if (qs === ns) return 92
  if (latin(q) === latin(n) || latin(qs) === latin(ns)) return 90
  if (qs.length >= 3 && n.startsWith(qs)) return 78 // «мам» → «мамочка», «мамуля»
  if (ns.length >= 3 && q.startsWith(ns)) return 70
  if (qs.length >= 4 && lev(qs, ns) <= 1) return 62 // опечатка/распознавание
  if (qs.length >= 4 && n.includes(qs)) return 55
  return 0
}

/** Похожие контакты: каждое слово запроса ищем среди слов имени. */
export function matchContacts(query: string, list: Contact[]): (Contact & { score: number })[] {
  const qw = cleanName(query)
    .split(' ')
    .filter((w) => w && !['моей', 'моему', 'мой', 'моя', 'мою', 'контакт', 'контакту', 'номер', 'по', 'телефону'].includes(w))
  if (!qw.length) return []
  const out: (Contact & { score: number })[] = []
  for (const c of list) {
    const nw = cleanName(c.name).split(' ').filter(Boolean)
    if (!nw.length) continue
    let total = 0
    for (const q of qw) total += Math.max(0, ...nw.map((n) => wordScore(q, n)))
    let score = total / qw.length
    if (score < 50) continue
    if (cleanName(c.name) === qw.join(' ')) score += 5
    if (c.starred) score += 3
    score += Math.min(3, (c.times || 0) / 20)
    out.push({ ...c, score })
  }
  // один и тот же человек с несколькими номерами — оставляем все, но имена с лучшим счётом выше
  return out.sort((a, b) => b.score - a.score).slice(0, 6)
}

export const maskNumber = (n: string) => {
  const d = n.replace(/\D/g, '')
  return d.length > 4 ? '*' + d.slice(-4) : n
}

// ---------- ожидающий подтверждения звонок ----------
type Pending = { options: Contact[]; at: number }
let pending: Pending | null = null
export const pendingCall = () => (pending && Date.now() - pending.at < 90000 ? pending : null)
export const clearPending = () => (pending = null)
export const setPending = (options: Contact[]) => (pending = { options, at: Date.now() })

/** Набрать номер. Вызывать только после подтверждения. */
export async function placeCall(c: Contact): Promise<{ ok: boolean; mode?: string; error?: string }> {
  pending = null
  return nativeCall<{ ok: boolean; mode?: string; error?: string }>('call', { number: c.number }, 60000).catch((e) => ({ ok: false, error: String(e) }))
}

/** Найти и спросить подтверждение. Никогда не звонит сам. */
export async function prepareCall(who: string): Promise<{ text: string; ok: boolean }> {
  if (!isAndroid) return { ok: false, text: 'Звонить я умею только в приложении Бурмалдец на телефоне.' }
  const { list, error } = await getContacts()
  if (error === 'denied') return { ok: false, text: 'Нет доступа к контактам. Разрешите «Контакты» для Бурмалдеца в настройках телефона, и я смогу звонить.' }
  if (error) return { ok: false, text: 'Не получилось прочитать контакты.' }
  const found = matchContacts(who, list)
  if (!found.length) {
    pending = null
    return { ok: false, text: `Контакта «${who}» не нашёл, и похожих тоже нет. Скажите имя иначе, как оно записано в телефоне.` }
  }
  const best = found[0]
  const sameName = found.filter((f) => f.name === best.name)
  const clear = found.length === 1 || found[1].score < best.score - 12 || sameName.length === found.length
  if (clear) {
    const opts = sameName.length > 1 ? sameName : [best]
    setPending(opts)
    const exact = best.score >= 90 // «маме» и «Мама ❤️» — одно и то же имя
    return {
      ok: true,
      text:
        opts.length > 1
          ? `У контакта «${best.name}» ${opts.length} номера: ${opts.map((o, i) => `${i + 1} — ${maskNumber(o.number)}`).join(', ')}. На какой звонить? Скажите номер варианта или «нет».`
          : `${exact ? '' : `Точно такого имени нет, но нашёл «${best.name}». `}Позвонить «${best.name}», номер ${maskNumber(best.number)}? Скажите «да» или «нет».`,
    }
  }
  const opts = found.slice(0, 4)
  setPending(opts)
  return { ok: true, text: `Нашёл похожие: ${opts.map((o, i) => `${i + 1} — «${o.name}»`).join(', ')}. Кому звонить? Скажите номер варианта или «нет».` }
}

const ORD: Record<string, number> = { первый: 1, первая: 1, первой: 1, первому: 1, один: 1, '1': 1, второй: 2, вторая: 2, второму: 2, два: 2, '2': 2, третий: 3, третья: 3, третьей: 3, третьему: 3, три: 3, '3': 3, четвертый: 4, четвертой: 4, четыре: 4, '4': 4 }

/** Ответ на вопрос «позвонить?». null — это не про звонок. */
export async function answerPending(s: string): Promise<{ text: string; emotion: 'спокойно' | 'грусть' | 'радость' } | null> {
  const p = pendingCall()
  if (!p) return null
  const t = cleanName(s)
  if (/^(нет|не надо|не звони|отмена|отмени|стоп|не нужно)(\s|$)/.test(t)) {
    pending = null
    return { text: 'Хорошо, не звоню.', emotion: 'спокойно' }
  }
  if (p.options.length === 1 && /^(да|ага|звони|позвони|давай|набирай|конечно|верно|угу|точно|ок|окей)(\s|$)/.test(t)) {
    const c = p.options[0]
    const r = await placeCall(c)
    return r.ok ? { text: r.mode === 'dial' ? `Открыл набор номера «${c.name}» — нажмите зелёную кнопку.` : `Звоню «${c.name}».`, emotion: 'радость' } : { text: 'Не получилось позвонить.', emotion: 'грусть' }
  }
  if (p.options.length > 1) {
    const n = t.split(' ').map((w) => ORD[w]).find(Boolean)
    let pick = n ? p.options[n - 1] : undefined
    if (!pick) {
      const m = matchContacts(s, p.options)
      if (m.length && (m.length === 1 || m[0].score > m[1].score + 10)) pick = m[0]
    }
    if (pick) {
      // выбор из списка — это ещё не «да»: переспрашиваем про конкретного человека
      setPending([pick])
      return { text: `Позвонить «${pick.name}», номер ${maskNumber(pick.number)}? Скажите «да» или «нет».`, emotion: 'спокойно' }
    }
  }
  return null
}
