// Навыки без ИИ: частые просьбы отвечаются мгновенно и даже когда серверы Gemini перегружены.
// Срабатывают только на простые, однозначные фразы — всё сложное уходит в Gemini.
import type { Reply } from './brain'
import { geocode, news, rates, weather, whereAmI } from './info'
import { getCity, memoryFacts, remember } from './memory'
import { addNote, listNotes } from './notes'
import { addExpense, report } from './expenses'
import { listReminders, sleepTimer } from './reminders'
import { getRate, setRate } from './speech'
import { aiReady } from './ai'
import { EXEC, newsCard, ratesCard, weatherCard } from './tools'
import { parseDuration } from './brain'
import { isAndroid, nativeCall } from './bridge'

type Any = Record<string, any>
const plural = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c)

/** «+3» → «плюс 3», «-5» → «минус 5». */
const deg = (n: number) => (n > 0 ? `плюс ${n}` : n < 0 ? `минус ${-n}` : 'ноль')
/** «от нуля до плюс 7» — после «от/до» ноль в родительном падеже. */
const degR = (n: number) => (n === 0 ? 'нуля' : deg(n))
/** Предложный падеж для названия города: Астана → в Астане, Шымкент → в Шымкенте, Казань → в Казани, Алматы → в Алматы. */
export function inCity(name: string) {
  const w = name.trim()
  if (/[ыиоуэю]$/i.test(w) || /\s/.test(w)) return w
  if (/а$/i.test(w)) return w.slice(0, -1) + 'е'
  if (/я$/i.test(w)) return w.slice(0, -1) + 'е'
  if (/ь$/i.test(w)) return w.slice(0, -1) + 'и'
  if (/й$/i.test(w)) return w.slice(0, -1) + 'е'
  return w + 'е'
}
const money = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') : String(+n.toFixed(2)).replace('.', ','))
const CUR_GEN: Record<string, string> = { USD: 'долларов', EUR: 'евро', RUB: 'рублей', KZT: 'тенге', CNY: 'юаней', GBP: 'фунтов', TRY: 'лир', KGS: 'сомов', UZS: 'сумов' }
const CUR_ONE: Record<string, string> = { USD: 'доллар', EUR: 'евро', RUB: 'рубль', KZT: 'тенге', CNY: 'юань', GBP: 'фунт', TRY: 'лира', bitcoin: 'биткоин', ethereum: 'эфир', 'the-open-network': 'тон' }

function weatherText(w: Any, when: 'now' | 'today' | 'tomorrow' | 'weekend'): string {
  const place = w.place && w.place !== 'текущее место' ? ` в ${inCity(w.place.split(',')[0])}` : ''
  const d = w.days || []
  if (when === 'tomorrow' && d[1]) {
    const x = d[1]
    return `Завтра${place} ${x.sky}, от ${degR(x.min_c)} до ${degR(x.max_c)}${x.rain_chance >= 40 ? `, вероятность осадков ${x.rain_chance} процентов` : ''}${x.wind_max_ms >= 10 ? `, ветер до ${x.wind_max_ms} метров в секунду` : ''}.`
  }
  if (when === 'weekend') {
    const we = d.filter((x: Any) => [0, 6].includes(new Date(x.date).getDay()))
    if (we.length) return `На выходных${place}: ` + we.map((x: Any) => `${new Date(x.date).getDay() === 6 ? 'в субботу' : 'в воскресенье'} ${x.sky}, до ${degR(x.max_c)}`).join(', ') + '.'
  }
  const n = w.now
  const t = d[0]
  const snowy = /снег|крупа/.test(`${n.sky} ${t?.sky || ''}`)
  const umbrella = t && t.rain_chance >= 50 ? (snowy ? ' Идёт снег — одевайтесь теплее.' : ' Возьмите зонт.') : ''
  return `Сейчас${place} ${deg(n.temp_c)}, ${n.sky}${Math.abs(n.feels_like_c - n.temp_c) >= 3 ? `, ощущается как ${deg(n.feels_like_c)}` : ''}.${t ? ` Сегодня от ${degR(t.min_c)} до ${degR(t.max_c)}.` : ''}${umbrella}`
}

export async function skill(s: string, raw = s): Promise<Reply | null> {
  let m: RegExpMatchArray | null

  // --- погода ---
  m = s.match(/^(?:а\s+)?(?:какая\s+|что\s+(?:там\s+)?(?:с|по)\s+)?погод\S*(?:\s+(?:сейчас|сегодня|на улице))?(?:\s+(завтра|на завтра|на выходных|на выходные))?(?:\s+(?:в|во)\s+([а-яё-]+(?:\s(?!завтра|сейчас|сегодня|утром|днём|днем|вечером|ночью|на\s)[а-яё-]+)?))?(?:\s+(?:сейчас|сегодня|на улице))?(?:\s+(завтра|на завтра|на выходных|на выходные))?$/)
  if (m) {
    const whenW = m[1] || m[3] || ''
    const w = (await weather(m[2], 7).catch(() => null)) as Any | null
    if (!w) return null
    if (w.need_city) return { text: 'В каком вы городе? Скажите, например: «я живу в Астане» — запомню.', emotion: 'думаю' }
    // незнакомое название (старое имя города, опечатка распознавания) — пусть разберётся ИИ
    if (!w.ok && /Не нашёл город/.test(String(w.error)) && aiReady()) return null
    if (!w.ok) return { text: String(w.error || 'Не получилось узнать погоду.'), emotion: 'грусть' }
    weatherCard(w)
    return { text: weatherText(w, /завтра/.test(whenW) ? 'tomorrow' : /выходн/.test(whenW) ? 'weekend' : 'now'), emotion: 'спокойно' }
  }
  if (/^(?:сколько (?:сейчас )?градусов|какая (?:сейчас )?температура|холодно ли|тепло ли|жарко ли)(?: (?:на улице|сегодня|сейчас))?$/.test(s)) {
    const w = (await weather(undefined, 3).catch(() => null)) as Any | null
    if (w?.need_city) return { text: 'В каком вы городе? Скажите, например: «я живу в Астане» — запомню.', emotion: 'думаю' }
    if (w?.ok) {
      weatherCard(w)
      return { text: weatherText(w, 'now'), emotion: 'спокойно' }
    }
  }
  // восход и закат
  m = s.match(/^(?:во сколько|когда)\s+(?:сегодня\s+|завтра\s+)?(закат|рассвет|восход)(?:\s+(сегодня|завтра))?(?:\s+(?:в|во)\s+([а-яё-]+))?$/)
  if (m) {
    const w = (await weather(m[3], 2).catch(() => null)) as Any | null
    if (w?.ok) {
      const d = /завтра/.test(s) ? w.days[1] : w.days[0]
      const t = m[1] === 'закат' ? d.sunset : d.sunrise
      return { text: `${/завтра/.test(s) ? 'Завтра' : 'Сегодня'} ${m[1] === 'закат' ? 'закат' : 'рассвет'} в ${t}.`, emotion: 'спокойно' }
    }
  }
  // время в другом городе
  m = s.match(/^(?:который (?:сейчас )?час|сколько (?:сейчас )?времени|какое (?:сейчас )?время)\s+(?:в|во)\s+([а-яёa-z-]+(?:\s[а-яёa-z-]+)?)$/)
  if (m) {
    const g = await geocode(m[1]).catch(() => null)
    if (g?.tz) {
      const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: g.tz })
      const diff = Math.round((new Date(new Date().toLocaleString('en-US', { timeZone: g.tz })).getTime() - new Date(new Date().toLocaleString('en-US')).getTime()) / 3600000)
      return { text: `В ${inCity(g.name)} сейчас ${t}${diff ? `, это ${diff > 0 ? 'на ' + diff : 'на ' + -diff} ${plural(Math.abs(diff), 'час', 'часа', 'часов')} ${diff > 0 ? 'больше' : 'меньше'}, чем у вас` : ', как у вас'}.`, emotion: 'спокойно' }
    }
  }
  if (/^(?:нужен ли|брать ли|взять ли) зонт\S*(?: сегодня| завтра)?$/.test(s)) {
    const w = (await weather(undefined, 2).catch(() => null)) as Any | null
    if (!w?.ok) return null
    const d = /завтра/.test(s) ? w.days[1] : w.days[0]
    return { text: d.rain_chance >= 40 || d.precipitation_mm > 0.5 ? `Лучше взять: вероятность осадков ${d.rain_chance} процентов.` : `Не нужен: осадков почти не ожидается.`, emotion: 'спокойно' }
  }

  // --- курсы ---
  m = s.match(/^(?:какой\s+)?курс\s+([а-яёa-z]+)(?:\s+(?:к|в)\s+([а-яёa-z]+))?$|^сколько\s+(?:сейчас\s+)?стоит\s+(доллар|евро|рубль|юань|биткоин|эфир|фунт)(?:\s+в\s+([а-яёa-z]+))?$/)
  if (m) {
    const from = m[1] || m[3]
    const to = m[2] || m[4]
    const TO: Record<string, string> = { тенге: 'KZT', тенгах: 'KZT', рублю: 'RUB', рублях: 'RUB', рублям: 'RUB', доллару: 'USD', долларах: 'USD', евро: 'EUR' }
    const FROM: Record<string, string> = { доллара: 'USD', доллар: 'USD', евро: 'EUR', рубля: 'RUB', рубль: 'RUB', юаня: 'CNY', юань: 'CNY', биткоина: 'bitcoin', биткоин: 'bitcoin', эфира: 'ethereum', эфир: 'ethereum', фунта: 'GBP', фунт: 'GBP', лиры: 'TRY', тенге: 'KZT' }
    const f = FROM[from]
    if (f) {
      const target = to ? [TO[to] || to] : f === 'KZT' ? ['USD', 'RUB'] : /bitcoin|ethereum/.test(f) ? ['USD', 'KZT'] : ['KZT', 'RUB']
      const r = (await rates(f, target, 1).catch(() => null)) as Any | null
      if (r?.ok) {
        ratesCard(r)
        const parts = Object.entries(r.rates as Record<string, number | null>).filter(([, v]) => v != null).map(([k, v]) => `${money(v as number)} ${CUR_GEN[k] || k}`)
        return { text: `Один ${CUR_ONE[f] || f} — примерно ${parts.join(', или ')}.`, emotion: 'спокойно' }
      }
    }
  }

  // --- пересчёт суммы: «сколько будет 100 долларов в тенге», «500 рублей в тенге» ---
  m = s.match(/^(?:сколько (?:будет )?|переведи |конвертируй )?(\d+(?:[.,]\d+)?)\s*(тысяч\S*\s+)?(доллар\S*|евро|рубл\S*|тенге|юан\S*|фунт\S*|лир\S*|сом\S*)\s+(?:в|на)\s+(тенге|рубл\S*|доллар\S*|евро|юан\S*)$/)
  if (m) {
    const CODE = (w: string) => (/доллар/.test(w) ? 'USD' : /евро/.test(w) ? 'EUR' : /рубл/.test(w) ? 'RUB' : /тенге/.test(w) ? 'KZT' : /юан/.test(w) ? 'CNY' : /фунт/.test(w) ? 'GBP' : /лир/.test(w) ? 'TRY' : 'KGS')
    const amount = parseFloat(m[1].replace(',', '.')) * (m[2] ? 1000 : 1)
    const r = (await rates(CODE(m[3]), [CODE(m[4])], amount).catch(() => null)) as Any | null
    ratesCard(r)
    const v = r?.ok ? (Object.values(r.rates)[0] as number | null) : null
    if (v != null) return { text: `${money(amount)} ${CUR_GEN[CODE(m[3])] || m[3]} — это примерно ${money(v)} ${CUR_GEN[CODE(m[4])] || m[4]}.`, emotion: 'спокойно' }
  }

  // --- новости ---
  m = s.match(/^(?:какие\s+|расскажи\s+|прочитай\s+|главные\s+|последние\s+|свежие\s+)*новост\S*(?:\s+(?:дня|сегодня|за сегодня))?(?:\s+(спорта|технологий|экономики|науки|кино|мира|казахстана|бизнеса|здоровья))?$/)
  if (m) {
    const n = (await news(m[1] || undefined, 4).catch(() => null)) as Any | null
    newsCard(n)
    if (n?.ok) return { text: (m[1] ? 'Коротко: ' : 'Главное: ') + n.items.slice(0, 3).map((x: Any) => x.title.replace(/[.!?]+$/, '')).join('. ') + '.', emotion: 'спокойно' }
  }

  // --- память ---
  m = s.match(/^(?:запомни(?:,)?\s+(?:что\s+)?)?(?:я живу|живу|я переехал\S*|я теперь живу)\s+(?:в|во)\s+([а-яё-]+(?:\s[а-яё-]+)?)$/)
  if (m) {
    const g = await geocode(m[1]).catch(() => null)
    // «я живу в своё удовольствие» — не город: пусть разбирается Gemini
    if (!g) return null
    const name = g.name
    remember('', { city: name })
    return { text: `Запомнил: вы живёте в ${inCity(name)}.`, emotion: 'радость' }
  }
  m = s.match(/^(?:запомни(?:,)?\s+(?:что\s+)?)?меня зовут\s+([а-яёa-z-]+)$/)
  if (m) {
    const nm = m[1].replace(/^./, (c) => c.toUpperCase())
    remember('', { name: nm })
    return { text: `Приятно познакомиться, ${nm}! Запомнил.`, emotion: 'радость' }
  }
  // «запомни, что …» — дословно, без толкований (имя/город — выше)
  m = s.match(/^запомни(?:,)?\s+(?:что\s+|пожалуйста\s+)?(.{4,})$/)
  if (m && !/^(?:меня зовут|я живу)/.test(m[1]) && !/^(?:эт[оиуа]|этот|эту|эти|его|её|ее|их)(?:\s|$)|рецепт/.test(m[1])) {
    // берём исходный текст — с заглавными буквами в именах
    const orig = raw.replace(/^\s*(?:бурмалд\S*|бур молодец|бор молодец|чекун\S*|чеку нет|чеку конец|шеф|chef)[\s,]*/i, '').match(/^запомни[,\s]+(?:что\s+|пожалуйста\s+)?(.{4,}?)[.!]?$/i)?.[1] || m[1]
    const fact = orig.trim()
    remember(fact)
    return { text: `Запомнил: «${fact}».`, emotion: 'радость' }
  }
  if (/^(?:как меня зовут|ты помнишь как меня зовут)$/.test(s)) {
    const f = memoryFacts().find((x) => x.startsWith('Зовут: '))
    return { text: f ? `Вас зовут ${f.slice(7)}.` : 'Вы ещё не говорили. Скажите: «меня зовут…».', emotion: 'спокойно' }
  }
  if (/^(?:где я живу|в каком городе я живу|мой город)$/.test(s)) {
    const c = getCity()
    return { text: c ? `Вы живёте в ${inCity(c)}.` : 'Вы ещё не говорили, где живёте.', emotion: 'спокойно' }
  }

  // --- заметки ---
  m = s.match(/^(?:запиши|сделай|создай|добавь|напиши|занеси)\s+(?:в\s+)?заметк\S*\s*:?\s+(.+)$/)
  if (m) {
    const r = addNote(m[1])
    return r.ok ? { text: `Записал в заметки: ${m[1]}.`, emotion: 'радость' } : null
  }
  if (/^(?:прочитай|покажи|какие|что в|мои)\s+(?:мои\s+)?заметк\S*$|^что я записывал\S*$/.test(s)) {
    const r = listNotes()
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/[.!?]+$/, '')
    return { text: r.count === 1 ? `Одна заметка: ${r.notes[0].text.replace(/[.!?]+$/, '')}.` : r.count ? `Заметок ${r.count}. ` + r.notes.slice(0, 5).map((n) => cap(n.text)).join('. ') + '.' : 'Заметок пока нет. Скажите: «запиши заметку…».', emotion: 'спокойно' }
  }

  // --- расходы ---
  m = s.match(/^(?:я\s+)?(?:потратил\S*|заплатил\S*|запиши трату|трата|расход)\s+(\d+(?:[.,]\d+)?)\s*(?:тысяч\S*\s*)?(тенге|тг|рубл\S*|доллар\S*|евро)?\s*(?:на|за)\s+(.+)$/)
  if (m) {
    const k = /тысяч/.test(s) && +m[1].replace(',', '.') < 1000 ? 1000 : 1
    const cur = /рубл/.test(m[2] || '') ? 'RUB' : /доллар/.test(m[2] || '') ? 'USD' : /евро/.test(m[2] || '') ? 'EUR' : 'KZT'
    const r = addExpense(parseFloat(m[1].replace(',', '.')) * k, m[3], cur, m[3])
    if (r.ok) return { text: `Записал: ${money(r.saved!.amount)} ${CUR_GEN[cur]} — ${r.saved!.category}.${cur === 'KZT' ? ` Сегодня всего ${money(r.today_total ?? 0)} тенге.` : ''}`, emotion: 'радость' }
  }
  m = s.match(/^сколько\s+(?:я\s+)?(?:всего\s+)?потратил\S*\s*(сегодня|за сегодня|за неделю|на этой неделе|за месяц|в этом месяце|за год|в этом году)?$/)
  if (m) {
    const p = !m[1] ? 'month' : /сегодня/.test(m[1]) ? 'today' : /недел/.test(m[1]) ? 'week' : /год/.test(m[1]) ? 'year' : 'month'
    const r = report(p)
    if (!r.count) return { text: `За ${r.period} трат не записано.`, emotion: 'спокойно' }
    const top = Object.entries(r.by_category).slice(0, 3).map(([k, v]) => `${k} — ${money(v as number)}`).join(', ')
    return { text: `${r.period[0].toUpperCase() + r.period.slice(1)}: ${money(r.total)} ${CUR_GEN[r.currency] || r.currency}. Больше всего: ${top}.`, emotion: 'спокойно' }
  }

  // --- напоминания ---
  if (/^(?:какие|покажи|мои|есть ли)\s+(?:у меня\s+)?напоминани\S*$|^что мне надо (?:сделать|не забыть)$/.test(s)) {
    const r = (await listReminders().catch(() => null)) as Any | null
    if (!r) return null
    return { text: r.count ? `Напоминаний: ${r.count}. ` + r.items.slice(0, 5).map((x: Any) => `${x.when} — ${x.text}`).join('. ') + '.' : 'Напоминаний нет.', emotion: 'спокойно' }
  }

  // --- скорость речи ---
  m = s.match(/^(?:говори|разговаривай|читай)\s+(побыстрее|быстрее|помедленнее|медленнее|нормально|как обычно|обычно)$/)
  if (m) {
    const cur = getRate()
    const v = /быстр/.test(m[1]) ? setRate(cur + 0.15) : /медлен/.test(m[1]) ? setRate(cur - 0.15) : setRate(1)
    return { text: v === 1 ? 'Хорошо, говорю в обычном темпе.' : v > cur ? 'Хорошо, буду говорить быстрее.' : v < cur ? 'Хорошо, буду говорить медленнее.' : 'Это уже предел.', emotion: 'спокойно' }
  }

  // --- яркость и «не беспокоить» ---
  m = s.match(/^(?:сделай\s+)?(ярче|темнее|поярче|потемнее)(?:\s+экран)?$|^(?:поставь\s+|сделай\s+)?яркость(?:\s+экрана)?\s+(?:на\s+)?(\d{1,3})(?:\s*процент\S*)?$|^(?:сделай\s+)?яркость(?:\s+экрана)?\s+(на максимум|на минимум)$/)
  if (m && isAndroid) {
    const args = m[2] ? { percent: +m[2] } : m[3] ? { percent: /максимум/.test(m[3]) ? 100 : 5 } : { direction: /ярче/.test(m[1]) ? 'up' : 'down' }
    const r = (await EXEC.set_brightness(args)) as Any
    return r.ok ? { text: `Яркость ${r.percent} ${plural(r.percent, 'процент', 'процента', 'процентов')}.`, emotion: 'спокойно' } : { text: String(r.note || 'Не получилось.'), emotion: 'грусть' }
  }
  m = s.match(/^(включи|выключи|отключи)\s+(?:режим\s+)?не беспокоить$/)
  if (m && isAndroid) {
    const on = m[1] === 'включи'
    const r = (await EXEC.do_not_disturb({ on })) as Any
    return r.ok ? { text: on ? 'Режим «Не беспокоить» включён.' : 'Режим «Не беспокоить» выключен.', emotion: 'спокойно' } : { text: String(r.note || 'Не получилось.'), emotion: 'грусть' }
  }

  // --- таймер сна ---
  m = s.match(/^(?:выключи|останови|поставь на паузу) музык\S*(?: через)? (.+?(?:минут\S*|час\S*))$|^таймер сна(?: на)? (.+?(?:минут\S*|час\S*))$/)
  if (m && isAndroid) {
    const sec = parseDuration(m[1] || m[2])
    if (sec) {
      const r = (await sleepTimer(sec / 60)) as Any
      return r.ok ? { text: `Хорошо, выключу музыку ${r.when}.`, emotion: 'спокойно' } : { text: String(r.note || r.error || 'Не получилось.'), emotion: 'грусть' }
    }
  }

  // --- сообщения: «напиши маме, что я скоро буду», «отправь Саше в телеграм: привет» ---
  m = s.match(/^(?:напиши|отправь|скинь)\s+(?:сообщение\s+)?([а-яёa-z-]+(?:\s[а-яёa-z-]+)?)\s+(?:в\s+(ватсап\S*|whatsapp|вотсап\S*|телеграм\S*|telegram|смс|sms)\s+)?(?:что|:)\s+(.+)$/)
  // «напиши сочинение/стих/письмо…» — это просьба написать текст, а не сообщение контакту
  if (m && /^(сочинени|стих|текст|письм|пост|истори|рассказ|код|программ|эссе|отзыв|резюме|статью|песн|поздравлени|сказк|шутк|анекдот|доклад|реферат|план|список|сообщени)/.test(m[1])) m = null
  if (m) {
    const app = !m[2] ? undefined : /теле|tele/.test(m[2]) ? 'telegram' : /смс|sms/.test(m[2]) ? 'sms' : 'whatsapp'
    const r = (await EXEC.send_message({ to: m[1], text: m[3], app })) as Any
    const q = r.ask_user_exactly || r.result?.ask_user_exactly
    if (q) return { text: q, emotion: 'спокойно' }
    if (r.error === 'pc' || !isAndroid) return { text: 'Сообщения отправляются только из приложения Бурмалдец на телефоне.', emotion: 'грусть' }
    if (/не найден/.test(String(r.error))) return { text: `Не нашёл в контактах «${m[1]}». Скажите имя, как оно записано в телефоне.`, emotion: 'грусть' }
    if (r.error || r.note) return { text: String(r.error || r.note).replace(/^./, (c) => c.toUpperCase()), emotion: 'грусть' }
    return null
  }

  // --- кто звонил ---
  if (/^(?:кто (?:мне )?звонил\S*|пропущенные(?: звонки)?|были ли звонки|мне кто-нибудь звонил)$/.test(s) && isAndroid) {
    const r = (await EXEC.recent_calls({ missed: /пропущ/.test(s), limit: 5 })) as Any
    if (!r.ok) return { text: String(r.error || r.note || 'Не получилось открыть журнал звонков.'), emotion: 'грусть' }
    if (!r.calls.length) return { text: 'Звонков не было.', emotion: 'спокойно' }
    return { text: 'Последние звонки: ' + r.calls.slice(0, 4).map((c: Any) => `${c.who}, ${c.type}, ${c.when}`).join('; ') + '.', emotion: 'спокойно' }
  }

  // --- что пришло ---
  if (/^(?:что (?:мне )?пришло|какие уведомления|прочитай уведомления|кто (?:мне )?писал|есть новые сообщения|мне кто-нибудь писал)$/.test(s) && isAndroid) {
    const r = (await EXEC.read_notifications({ minutes: 720 })) as Any
    if (!r.ok) return null // объяснит Gemini (как включить доступ)
    if (!r.count) return { text: 'Новых уведомлений нет.', emotion: 'спокойно' }
    return { text: `Уведомлений: ${r.count}. ` + r.items.slice(0, 4).map((n: Any) => `${n.from || n.app}: ${String(n.text).slice(0, 90)}`).join('. ') + '.', emotion: 'спокойно' }
  }

  // --- сколько дней до… ---
  m = s.match(/^сколько (?:осталось )?(?:дней )?до (нового года|наурыз\S*|8 марта|восьмого марта|дня рождения|лета|зимы|весны|осени|конца месяца|конца года)$/)
  if (m) {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const y = now.getFullYear()
    const at = (mo: number, d: number) => {
      const t = new Date(y, mo, d)
      return t < now ? new Date(y + 1, mo, d) : t
    }
    const T: Record<string, () => Date | null> = {
      'нового года': () => new Date(y + 1, 0, 1),
      наурыз: () => at(2, 22),
      '8 марта': () => at(2, 8),
      'восьмого марта': () => at(2, 8),
      лета: () => at(5, 1),
      осени: () => at(8, 1),
      зимы: () => at(11, 1),
      весны: () => at(2, 1),
      'конца месяца': () => new Date(y, now.getMonth() + 1, 0),
      'конца года': () => new Date(y, 11, 31),
      'дня рождения': () => null,
    }
    const key = Object.keys(T).find((k) => m![1].startsWith(k.slice(0, 6)))
    const d = key ? T[key]() : null
    if (d) {
      const n = Math.round((d.getTime() - now.getTime()) / 86400000)
      return { text: n === 0 ? 'Это сегодня!' : `${n} ${plural(n, 'день', 'дня', 'дней')}.`, emotion: 'спокойно' }
    }
  }

  // --- сводка дня ---
  if (/^(?:доброе утро|добрый день|добрый вечер|сводка(?: дня)?|утренняя сводка|расскажи сводку|что сегодня|что у меня сегодня по плану)$/.test(s)) {
    const h = new Date().getHours()
    const hi = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
    const nameF = memoryFacts().find((x) => x.startsWith('Зовут: '))
    const [w, r, n, c] = await Promise.allSettled([
      weather(undefined, 1),
      listReminders(),
      news(undefined, 2),
      isAndroid ? nativeCall<{ ok: boolean; events?: { title: string; start: number; all_day: boolean }[] }>('calendar', { days: 1 }, 15000) : Promise.resolve(null),
    ])
    const parts = [`${hi}${nameF ? ', ' + nameF.slice(7) : ''}!`]
    const wv = w.status === 'fulfilled' ? (w.value as Any) : null
    if (wv?.ok) parts.push(weatherText(wv, 'now'))
    const cv = c.status === 'fulfilled' ? c.value : null
    const today = (cv?.ok && cv.events ? cv.events : []).filter((e) => new Date(e.start).toDateString() === new Date().toDateString())
    if (today.length)
      parts.push(`В календаре ${today.length === 1 ? 'одно событие' : today.length + ' событий'}: ` + today.slice(0, 3).map((e) => (e.all_day ? e.title : `${new Date(e.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} ${e.title}`)).join(', ') + '.')
    const rv = r.status === 'fulfilled' ? (r.value as Any) : null
    const todayR = (rv?.items || []).filter((x: Any) => String(x.when).startsWith('сегодня'))
    if (todayR.length) parts.push('Напомню: ' + todayR.slice(0, 3).map((x: Any) => `${x.when.replace('сегодня ', '')} — ${x.text}`).join(', ') + '.')
    const nv = n.status === 'fulfilled' ? (n.value as Any) : null
    if (nv?.ok) parts.push('В новостях: ' + nv.items.slice(0, 2).map((x: Any) => x.title.replace(/[.!?]+$/, '')).join('. ') + '.')
    return { text: parts.join(' '), emotion: 'радость' }
  }

  // --- где я ---
  if (/^(?:где я|где я сейчас|где я нахожусь|какой (?:это|здесь) адрес|на какой я улице)$/.test(s)) {
    const r = (await whereAmI().catch(() => null)) as Any | null
    if (!r?.ok) return { text: 'Не могу определить, где вы: нет доступа к местоположению.', emotion: 'грусть' }
    return { text: `Вы в ${inCity(r.city)}${r.district ? `, ${r.district}` : ''}${r.street ? `, ${r.street}` : ''}.`, emotion: 'спокойно' }
  }

  return null
}
