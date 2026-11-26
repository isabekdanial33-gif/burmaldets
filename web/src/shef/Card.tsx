// Карточки под ответом (как у Алисы): погода, курсы, новости. Данные кладут навыки и инструменты в ui.card.
export type Card =
  | { kind: 'weather'; place: string; temp: number; feels: number; sky: string; days: { date: string; sky: string; min: number; max: number; rain: number }[] }
  | { kind: 'rates'; from: string; amount: number; rates: Record<string, number | null> }
  | { kind: 'news'; topic: string; items: { title: string; source: string }[] }

const sign = (n: number) => (n > 0 ? '+' + n : String(n))

/** Простые значки погоды линиями — в стиле голограммы. */
function SkyIcon({ sky, size = 44 }: { sky: string; size?: number }) {
  const s = sky.toLowerCase()
  const sun = /ясно/.test(s)
  const rain = /дожд|морос|ливень/.test(s)
  const snow = /снег|крупа/.test(s)
  const storm = /гроз/.test(s)
  const fog = /туман|изморозь/.test(s)
  const partly = /переменн|преимущественно/.test(s)
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      {(sun || partly) && (
        <g transform={partly ? 'translate(-6 -6) scale(0.8)' : undefined}>
          <circle cx="24" cy="24" r="8" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="24" y1="9" x2="24" y2="5" transform={`rotate(${a} 24 24)`} />
          ))}
        </g>
      )}
      {!sun && <path d="M14 34h21a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0 0 13z" fill="rgba(110,230,255,0.08)" />}
      {rain && [16, 24, 32].map((x) => <line key={x} x1={x} y1="38" x2={x - 2} y2="44" />)}
      {snow && [16, 24, 32].map((x) => <circle key={x} cx={x} cy="41" r="1.4" fill="currentColor" />)}
      {storm && <path d="M25 35l-4 6h5l-3 6" />}
      {fog && [38, 43].map((y) => <line key={y} x1="10" y1={y} x2="38" y2={y} />)}
    </svg>
  )
}

const CUR_SIGN: Record<string, string> = { KZT: '₸', RUB: '₽', USD: '$', EUR: '€', CNY: '¥', GBP: '£' }
const NAME: Record<string, string> = { USD: 'Доллар', EUR: 'Евро', RUB: 'Рубль', KZT: 'Тенге', CNY: 'Юань', GBP: 'Фунт', bitcoin: 'Биткоин', ethereum: 'Эфир' }
const num = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }))

export default function CardView({ card }: { card: Card }) {
  if (card.kind === 'weather')
    return (
      <div className="shef-card" aria-label={`Погода: ${card.place}`}>
        <div className="shef-card-w">
          <SkyIcon sky={card.sky} size={52} />
          <div>
            <div className="shef-card-big">{sign(card.temp)}°</div>
            <div className="shef-card-sub">
              {card.place} · {card.sky} · ощущается {sign(card.feels)}°
            </div>
          </div>
        </div>
        <div className="shef-card-days">
          {card.days.slice(0, 3).map((d, i) => (
            <div key={d.date}>
              <span>{i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : new Date(d.date).toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              <SkyIcon sky={d.sky} size={26} />
              <b>
                {sign(d.max)}° <small>{sign(d.min)}°</small>
              </b>
              {d.rain >= 30 && <small>{d.rain}%</small>}
            </div>
          ))}
        </div>
      </div>
    )
  if (card.kind === 'rates')
    return (
      <div className="shef-card" aria-label="Курсы">
        <div className="shef-card-sub">
          {card.amount !== 1 ? num(card.amount) + ' ' : ''}
          {NAME[card.from] || card.from}
        </div>
        <div className="shef-card-rates">
          {Object.entries(card.rates)
            .filter(([, v]) => v != null)
            .map(([k, v]) => (
              <div key={k}>
                <b>{num(v as number)}</b> <span>{CUR_SIGN[k] || k}</span>
              </div>
            ))}
        </div>
      </div>
    )
  return (
    <div className="shef-card" aria-label="Новости">
      <div className="shef-card-sub">Новости · {card.topic}</div>
      <ol className="shef-card-news">
        {card.items.slice(0, 4).map((n) => (
          <li key={n.title}>
            {n.title}
            {n.source && <small> — {n.source}</small>}
          </li>
        ))}
      </ol>
    </div>
  )
}
