// Свежие данные из открытых источников без ключей: погода (Open-Meteo), курсы (open.er-api, CoinGecko),
// новости (Google Новости RSS), справка (Википедия). На телефоне — через приложение, на компьютере — /api/web.
import { isAndroid, nativeCall } from './bridge'
import { desk, isDesktop } from './net'
import { getCity } from './memory'

type Obj = Record<string, unknown>
type Any = Record<string, any>

// те же адреса, что и в белом списке телефона (MainActivity.WEB_OK) и /api/web
const WEB_HOSTS = /^(api\.open-meteo\.com|geocoding-api\.open-meteo\.com|open\.er-api\.com|api\.coingecko\.com|news\.google\.com|(ru|en)\.wikipedia\.org|nominatim\.openstreetmap\.org)$/

export async function webGet(url: string, timeout = 12000): Promise<string> {
  if (isDesktop) {
    if (!WEB_HOSTS.test(new URL(url).hostname)) throw new Error('host')
    const r = await desk!.fetch(url, { headers: { 'Accept-Language': 'ru' } }, timeout)
    if (r.status !== 200) throw new Error(`http ${r.status}`)
    return r.body
  }
  if (isAndroid) {
    const r = await nativeCall<{ status: number; body: string }>('http', { url }, timeout)
    if (r.status !== 200) throw new Error(`http ${r.status}`)
    return r.body
  }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  try {
    const r = await fetch('/api/web?u=' + encodeURIComponent(url), { signal: ctl.signal })
    if (!r.ok) throw new Error(`http ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(t)
  }
}
const getJson = async (url: string) => JSON.parse(await webGet(url))

// ---------- место ----------
type Place = { name: string; lat: number; lon: number; country?: string; tz?: string }

const cache = new Map<string, { at: number; v: unknown }>()
async function cached<T>(k: string, ttl: number, f: () => Promise<T>): Promise<T> {
  const c = cache.get(k)
  if (c && Date.now() - c.at < ttl) return c.v as T
  const v = await f()
  cache.set(k, { at: Date.now(), v })
  return v
}

type GeoHit = Place & { pop: number }
async function geocodeList(name: string): Promise<GeoHit[]> {
  return cached('geo5:' + name.toLowerCase(), 86400000, async () => {
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=ru&format=json`)
    return ((j.results || []) as Any[]).map((r) => ({ name: r.name, lat: r.latitude, lon: r.longitude, country: r.country, tz: r.timezone, pop: r.population || 0 }))
  })
}

/** Город из речи часто в падеже: «в Астане», «в Москве», «в Шымкенте», «в Казани» — ищем начальную форму.
 *  Берём точное совпадение названия с самым большим населением (иначе «Москве» находит посёлок «Москверо»). */
export async function geocode(name: string): Promise<Place | null> {
  const n = name.trim()
  const low = n.toLowerCase().replace(/ё/g, 'е')
  const cands = [n]
  if (/е$/.test(low)) cands.push(n.slice(0, -1) + 'а', n.slice(0, -1), n.slice(0, -1) + 'ь', n.slice(0, -1) + 'я')
  if (/и$/.test(low)) cands.push(n.slice(0, -1) + 'ь', n.slice(0, -1) + 'а', n.slice(0, -1) + 'ы', n.slice(0, -1) + 'и')
  if (/у$/.test(low)) cands.push(n.slice(0, -1) + 'а')
  let best: GeoHit | null = null
  for (const c of [...new Set(cands)]) {
    const hits = await geocodeList(c).catch(() => [] as GeoHit[])
    const same = hits.filter((h) => h.name.toLowerCase().replace(/ё/g, 'е') === c.toLowerCase().replace(/ё/g, 'е'))
    for (const h of same) if (!best || h.pop > best.pop) best = h
  }
  if (best) return best
  // ничего точного — первое найденное, если это заметный город
  const any = (await geocodeList(n).catch(() => [] as GeoHit[]))[0]
  return any && any.pop >= 50000 ? any : null
}

/** Где пользователь: названный город → запомненный город → место телефона/браузера. */
export async function wherePlace(city?: string, deviceFirst = false): Promise<Place | { error: string }> {
  const c = (city || '').trim()
  if (c) return (await geocode(c)) || { error: `Не нашёл город «${c}».` }
  const home = deviceFirst ? '' : getCity()
  if (home) {
    const p = await geocode(home)
    if (p) return p
  }
  try {
    if (isAndroid) {
      const r = await nativeCall<{ ok?: boolean; lat?: number; lon?: number }>('location', {}, 20000)
      if (r.ok && r.lat != null && r.lon != null) return { name: 'здесь', lat: r.lat, lon: r.lon }
    } else if ('geolocation' in navigator) {
      const pos = await new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000, maximumAge: 3600000 }))
      return { name: 'здесь', lat: pos.coords.latitude, lon: pos.coords.longitude }
    }
  } catch {
    /* нет доступа к месту */
  }
  return { error: 'need_city' }
}

/** Где я: город, район, улица по месту телефона (OpenStreetMap). Кешируем — не чаще раза в 10 минут на точку. */
export async function whereAmI(): Promise<Obj> {
  const p = await wherePlace(undefined, true)
  if ('error' in p) return { ok: false, error: p.error === 'need_city' ? 'Не знаю, где вы: нет доступа к местоположению.' : p.error }
  return reverse(p.lat, p.lon)
}

async function reverse(lat: number, lon: number): Promise<Obj> {
  const j = await cached(`rev:${lat.toFixed(3)},${lon.toFixed(3)}`, 600000, () =>
    getJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru&zoom=17`),
  )
  const a = j.address || {}
  return {
    ok: true,
    city: a.city || a.town || a.village || a.state || '',
    district: a.city_district || a.suburb || a.district || '',
    street: [a.road, a.house_number].filter(Boolean).join(', '),
    country: a.country || '',
    full: j.display_name,
  }
}

// ---------- погода ----------
const WMO: Record<number, string> = {
  0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'изморозь и туман',
  51: 'слабая морось', 53: 'морось', 55: 'сильная морось', 56: 'ледяная морось', 57: 'сильная ледяная морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'ледяной дождь', 67: 'сильный ледяной дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежная крупа', 80: 'кратковременный дождь', 81: 'ливень', 82: 'сильный ливень',
  85: 'снегопад', 86: 'сильный снегопад', 95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза с градом',
}
const sky = (c: number) => WMO[c] ?? 'без осадков'

export async function weather(city?: string, days = 3): Promise<Obj> {
  const p = await wherePlace(city)
  if ('error' in p) return p.error === 'need_city' ? { ok: false, need_city: true, note: 'Спроси у пользователя город и запомни его через remember (city).' } : { ok: false, error: p.error }
  const n = Math.min(7, Math.max(1, days))
  const j = await cached(`w:${p.lat.toFixed(2)},${p.lon.toFixed(2)},${n}`, 600000, () =>
    getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=${n}&wind_speed_unit=ms`,
    ),
  )
  const cur = j.current
  const d = j.daily
  const hourNow = new Date().getHours()
  const hours = (j.hourly?.time as string[] | undefined)
    ?.map((t, i) => ({ t, temp: Math.round(j.hourly.temperature_2m[i]), rain: j.hourly.precipitation_probability[i], sky: sky(j.hourly.weather_code[i]) }))
    .filter((h) => {
      const dt = new Date(h.t)
      return dt.getDate() === new Date().getDate() && dt.getHours() > hourNow && dt.getHours() % 3 === 0
    })
    .map((h) => ({ hour: new Date(h.t).getHours(), temp_c: h.temp, rain_chance: h.rain, sky: h.sky }))
  return {
    ok: true,
    place: p.name === 'здесь' ? (((await reverse(p.lat, p.lon).catch(() => null)) as { city?: string } | null)?.city || 'текущее место') : `${p.name}${p.country ? ', ' + p.country : ''}`,
    now: { temp_c: Math.round(cur.temperature_2m), feels_like_c: Math.round(cur.apparent_temperature), sky: sky(cur.weather_code), wind_ms: Math.round(cur.wind_speed_10m), humidity: cur.relative_humidity_2m, precipitation_mm: cur.precipitation },
    later_today: hours,
    days: (d.time as string[]).map((t: string, i: number) => ({
      date: t,
      sky: sky(d.weather_code[i]),
      min_c: Math.round(d.temperature_2m_min[i]),
      max_c: Math.round(d.temperature_2m_max[i]),
      rain_chance: d.precipitation_probability_max[i],
      precipitation_mm: d.precipitation_sum[i],
      wind_max_ms: Math.round(d.wind_speed_10m_max[i]),
      sunrise: String(d.sunrise[i]).slice(11),
      sunset: String(d.sunset[i]).slice(11),
      uv: d.uv_index_max[i],
    })),
  }
}

// ---------- курсы ----------
const CUR: Record<string, string> = {
  доллар: 'USD', доллара: 'USD', долларов: 'USD', usd: 'USD', евро: 'EUR', eur: 'EUR', рубль: 'RUB', рубля: 'RUB', рублей: 'RUB', rub: 'RUB',
  тенге: 'KZT', kzt: 'KZT', юань: 'CNY', юаня: 'CNY', юаней: 'CNY', cny: 'CNY', фунт: 'GBP', фунта: 'GBP', gbp: 'GBP', лира: 'TRY', лиры: 'TRY', try: 'TRY',
  сом: 'KGS', сума: 'UZS', сум: 'UZS', дирхам: 'AED', дирхама: 'AED', иена: 'JPY', иены: 'JPY', вон: 'KRW', вона: 'KRW', лари: 'GEL', драм: 'AMD', гривна: 'UAH', гривны: 'UAH',
}
const code = (s: string) => {
  const t = s.trim().toLowerCase()
  return /^[a-z]{3}$/i.test(t) ? t.toUpperCase() : CUR[t] || t.toUpperCase()
}
const COINS: Record<string, string> = { btc: 'bitcoin', биткоин: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum', эфир: 'ethereum', ethereum: 'ethereum', usdt: 'tether', tether: 'tether', ton: 'the-open-network', тон: 'the-open-network', sol: 'solana', солана: 'solana', bnb: 'binancecoin', doge: 'dogecoin', доги: 'dogecoin', xrp: 'ripple' }

export async function rates(from: string, to: string[], amount = 1): Promise<Obj> {
  const f = from.trim().toLowerCase()
  const coin = COINS[f]
  const targets = (to.length ? to : ['KZT', 'USD', 'RUB']).map(code)
  if (coin) {
    const vs = targets.map((x) => x.toLowerCase()).join(',')
    const j = await cached('cg:' + coin + vs, 120000, () => getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${vs}&include_24hr_change=true`))
    const r = j[coin] || {}
    return { ok: true, source: 'CoinGecko', amount, from: coin, rates: Object.fromEntries(targets.map((t) => [t, r[t.toLowerCase()] != null ? +(r[t.toLowerCase()] * amount).toFixed(2) : null])), change_24h_pct: r[`${targets[0].toLowerCase()}_24h_change`] }
  }
  const base = code(from)
  const j = await cached('fx:' + base, 3600000, () => getJson(`https://open.er-api.com/v6/latest/${base}`))
  if (j.result !== 'success') return { ok: false, error: `Не знаю валюту «${from}».` }
  const out: Obj = {}
  for (const t of targets) out[t] = j.rates[t] != null ? +(j.rates[t] * amount).toFixed(j.rates[t] * amount < 10 ? 4 : 2) : null
  return { ok: true, source: 'open.er-api.com (рыночный, обновляется раз в сутки)', updated: j.time_last_update_utc, amount, from: base, rates: out }
}

// ---------- Википедия ----------
export async function wiki(query: string): Promise<Obj> {
  const s = await getJson(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&utf8=1`)
  const hits = (s.query?.search || []) as { title: string }[]
  if (!hits.length) return { ok: false, error: 'В Википедии не нашлось.' }
  const sum = await getJson(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title.replace(/ /g, '_'))}`)
  return { ok: true, title: sum.title, description: sum.description, extract: String(sum.extract || '').slice(0, 1500), other_titles: hits.slice(1).map((h) => h.title) }
}

// ---------- новости ----------
const SECTIONS: [RegExp, string][] = [
  [/^(новости )?(спорт\S*|спортивн\S*)( новости)?$/, 'SPORTS'],
  [/^(новости )?(технолог\S*|техно|гаджет\S*|it|айти)( новости)?$/, 'TECHNOLOGY'],
  [/^(новости )?(бизнес\S*|экономик\S*|финанс\S*)( новости)?$/, 'BUSINESS'],
  [/^(новости )?(наук\S*)( новости)?$/, 'SCIENCE'],
  [/^(новости )?(здоровь\S*|медицин\S*)( новости)?$/, 'HEALTH'],
  [/^(новости )?(развлечен\S*|кино|шоу.?бизнес\S*|звезд\S*)( новости)?$/, 'ENTERTAINMENT'],
  [/^(новости )?(мир\S*|в мире|международн\S*)( новости)?$/, 'WORLD'],
]

async function rss(q: string, limit: number) {
  const sec = SECTIONS.find(([re]) => re.test(q.toLowerCase()))?.[1]
  const url = sec
    ? `https://news.google.com/rss/headlines/section/topic/${sec}?hl=ru&gl=RU&ceid=RU:ru`
    : q
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:2d')}&hl=ru&gl=RU&ceid=RU:ru`
      : 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru'
  const xml = await cached('news:' + q, 300000, () => webGet(url))
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return [...doc.querySelectorAll('item')].slice(0, limit).map((it) => {
    const src = it.querySelector('source')?.textContent || ''
    let title = it.querySelector('title')?.textContent || ''
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3))
    const d = new Date(it.querySelector('pubDate')?.textContent || '')
    return { title, source: src, when: isNaN(+d) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }
  })
}

export async function news(query?: string, limit = 6): Promise<Obj> {
  const q = (query || '').trim()
  const n = Math.min(10, Math.max(1, limit))
  if (!q) {
    // главное: половина — Казахстан, половина — мир
    const [kz, top] = await Promise.allSettled([rss('Казахстан', Math.ceil(n / 2)), rss('', n)])
    const a = kz.status === 'fulfilled' ? kz.value : []
    const seen = new Set(a.map((x) => x.title))
    const b = (top.status === 'fulfilled' ? top.value : []).filter((x) => !seen.has(x.title))
    const items = [...a, ...b].slice(0, n)
    return items.length ? { ok: true, topic: 'главное: Казахстан и мир', items } : { ok: false, error: 'Новости не загрузились.' }
  }
  const items = await rss(q, n)
  return items.length ? { ok: true, topic: q, items } : { ok: false, error: 'Новостей не нашлось.' }
}
