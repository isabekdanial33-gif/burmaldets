// Открытые данные для Шефа на компьютере: погода, курсы, новости, Википедия.
// GET /api/web?u=<https-адрес> — только сайты из списка (иначе это был бы открытый прокси).
export const WEB_OK = new Set([
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'open.er-api.com',
  'api.coingecko.com',
  'ru.wikipedia.org',
  'en.wikipedia.org',
  'news.google.com',
  'nominatim.openstreetmap.org',
])

export async function handleWeb(target: string | null): Promise<{ status: number; body: string; type: string }> {
  let u: URL
  try {
    u = new URL(target || '')
  } catch {
    return { status: 400, body: '{"error":"url"}', type: 'application/json' }
  }
  if (u.protocol !== 'https:' || !WEB_OK.has(u.hostname)) return { status: 400, body: '{"error":"host"}', type: 'application/json' }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 10000)
  try {
    // редиректы — только внутри белого списка (не больше трёх переходов)
    let r = await fetch(u, { headers: { 'User-Agent': 'ShefAssistant/1.0 (PC)', 'Accept-Language': 'ru' }, signal: ctl.signal, redirect: 'manual' })
    for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400; hop++) {
      const next = new URL(r.headers.get('location') || '', u)
      if (next.protocol !== 'https:' || !WEB_OK.has(next.hostname)) return { status: 400, body: '{"error":"redirect"}', type: 'application/json' }
      u = next
      r = await fetch(u, { headers: { 'User-Agent': 'ShefAssistant/1.0 (PC)', 'Accept-Language': 'ru' }, signal: ctl.signal, redirect: 'manual' })
    }
    const body = (await r.text()).slice(0, 600_000)
    return { status: r.status, body, type: r.headers.get('content-type') || 'text/plain' }
  } finally {
    clearTimeout(t)
  }
}

export async function GET(request: Request): Promise<Response> {
  const res = await handleWeb(new URL(request.url).searchParams.get('u'))
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.type, 'Cache-Control': 'public, max-age=300' } })
}
