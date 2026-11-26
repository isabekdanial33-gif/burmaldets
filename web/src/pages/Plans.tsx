import { useMemo } from 'react'
import { type IndexItem, plural } from '../data'
import { fmtPrice, fmtUntil, mySubs, type Plan, PLANS } from '../plans'
import { accounts, configured, freeMode, type PlanCode, useAuth } from '../supa'
import { CrownIcon, loginHref, toast } from '../ui'

type Row = { label: string; on: PlanCode[] | 'all'; note?: string }
const ALL: PlanCode[] = ['weekday', 'sweet', 'pp', 'gourmet', 'chef', 'grandchef']
const ROWS: Row[] = [
  { label: 'Бесплатные рецепты, таймеры, список покупок', on: 'all' },
  { label: 'КБЖУ на порцию', on: 'all' },
  { label: 'Быстрые рецепты: завтраки, супы, гарниры', on: ['weekday', 'chef', 'grandchef'] },
  { label: 'Выпечка и десерты', on: ['sweet', 'chef', 'grandchef'] },
  { label: 'ПП, вегетарианские и постные', on: ['pp', 'chef', 'grandchef'] },
  { label: 'Мясо, рыба и праздничный стол', on: ['gourmet', 'chef', 'grandchef'] },
  { label: 'Все рецепты каталога', on: ['chef', 'grandchef'] },
  { label: 'Шеф-ассистент: меню на неделю', on: ['grandchef'], note: '100 раз в месяц' },
  { label: 'Цель по калориям и БЖУ', on: ['grandchef'] },
  { label: 'Список покупок на неделю одной кнопкой', on: ['grandchef'] },
  { label: 'Золотой значок в отзывах', on: ['grandchef'] },
]

const FAQ: [string, string][] = [
  ['Есть ли автопродление?', 'Нет. Каждая оплата — разовая: деньги не спишутся сами. Когда срок подходит к концу, вы просто оплачиваете ещё раз, если хотите продолжить.'],
  ['Как оплатить?', 'Банковской картой через Payhip — это международный платёжный сервис, данные карты мы не видим и не храним. При оплате укажите тот же e-mail, что в вашем аккаунте MyGrandChef, — доступ откроется автоматически.'],
  ['На сколько открывается доступ?', 'На 30 дней с момента оплаты. Если продлить заранее, новые 30 дней добавятся к текущему сроку — ничего не сгорит.'],
  ['Как отменить подписку?', 'Отменять ничего не нужно: автосписаний нет. Не продлили — доступ просто закончится в указанную дату, а избранное и дневник останутся.'],
  ['Можно ли пользоваться с нескольких устройств?', 'Да, до 3 устройств — например, телефон, планшет на кухне и ноутбук. Подписка — для вас и вашей семьи.'],
  ['Чем Grand Chef отличается от «Шефа»?', 'Оба открывают все рецепты. Grand Chef добавляет шеф-ассистента: он составляет меню на неделю под вашу цель по калориям, объясняет, чем полезно каждое блюдо, и собирает список покупок одной кнопкой.'],
]

const mark = (on: boolean) =>
  on ? (
    <span className="cmp-yes" aria-label="входит">
      ✓
    </span>
  ) : (
    <span className="cmp-no" aria-label="не входит">
      —
    </span>
  )

function Cta({ p, gold, current }: { p: Plan; gold?: boolean; current: boolean }) {
  const { email } = useAuth()
  const cls = 'btn ' + (gold ? 'gold-btn' : 'primary') + ' plan-cta'
  if (!p.checkout)
    return (
      <button className={'btn plan-cta soon'} disabled aria-disabled>
        Оплата скоро
      </button>
    )
  if (!email)
    return (
      <a className={cls} href={loginHref('/plans')}>
        Оформить
      </a>
    )
  return (
    <a
      className={cls}
      href={p.checkout}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => toast(`Укажите при оплате ${email}`)}
    >
      {current ? 'Продлить на 30 дней' : 'Оформить'} ↗
    </a>
  )
}

function Badge({ until }: { until: string | null | undefined }) {
  if (until === undefined) return null
  return <span className="your-plan">{until === null ? '∞ Навсегда' : 'Ваш тариф · ' + fmtUntil(until)}</span>
}

export default function Plans({ items }: { items: IndexItem[] }) {
  const { access, email } = useAuth()
  const subs = mySubs(access)
  const untilOf = (c: PlanCode) => subs.find((s) => s.plan.code === c)?.until
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    const free = items.filter((i) => i.fr).length
    for (const c of ALL) m[c] = c === 'chef' || c === 'grandchef' ? items.length : items.filter((i) => i.fr || i.pl.includes(c)).length
    m.free = free
    return m
  }, [items])
  const gc = PLANS.find((p) => p.code === 'grandchef')!
  const rest = PLANS.filter((p) => p.code !== 'grandchef')
  const anyCheckout = PLANS.some((p) => p.checkout)

  return (
    <div className="plans-page">
      <header className="plans-head">
        <div className="eyebrow">Тарифы MyGrandChef</div>
        <h1>Готовьте в ГрандШефе без поиска и догадок</h1>
        <p>{freeMode ? 'Сейчас все рецепты и шеф-ассистент бесплатны. Тарифы ниже — как это будет работать после запуска оплаты.' : `Разовая оплата на 30 дней, без автопродления. ${counts.free} рецептов доступны бесплатно — просто войдите.`}</p>
        {email && subs.length > 0 && (
          <div className="plans-mine">
            Сейчас у вас: <b>{subs.map((s) => s.plan.name).join(', ')}</b> · {fmtUntil(subs[0].until)}
          </div>
        )}
      </header>

      {/* ---- Grand Chef ---- */}
      <section className={'gc-card' + (untilOf('grandchef') !== undefined ? ' mine' : '')} aria-labelledby="gc-title">
        <div className="gc-glow" aria-hidden />
        <div className="gc-left">
          <div className="gc-tags">
            <span className="best-pill">
              <CrownIcon size={13} /> Лучший выбор
            </span>
            <Badge until={untilOf('grandchef')} />
          </div>
          <h2 id="gc-title">
            {gc.emoji} {gc.name}
          </h2>
          <p className="gc-tagline">Все {counts.grandchef.toLocaleString('ru')} рецептов + шеф-ассистент, который планирует питание за вас</p>
          <div className="gc-price">
            <b>{fmtPrice(gc.price)} ₸</b>
            <span>/мес</span>
            <small>≈ {gc.usd}</small>
          </div>
          <Cta p={gc} gold current={untilOf('grandchef') !== undefined} />
          {email && gc.checkout && <p className="cta-hint">Укажите при оплате тот же e-mail, что в аккаунте: <b>{email}</b></p>}
          <a className="gc-try" href="#/planner">
            Как работает шеф-ассистент →
          </a>
        </div>
        <ul className="gc-features">
          {gc.features.filter((f) => accounts || !/отзыв/i.test(f)).map((f) => (
            <li key={f}>
              <span className="gc-check" aria-hidden>
                ✓
              </span>
              {f}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- остальные ---- */}
      <section className="plan-grid" aria-label="Другие тарифы">
        {rest.map((p) => {
          const until = untilOf(p.code)
          return (
            <article key={p.code} className={'plan-card' + (until !== undefined ? ' mine' : '') + (p.code === 'chef' ? ' chef' : '')} style={{ '--pc': p.color } as React.CSSProperties}>
              <div className="plan-top">
                <span className="plan-emoji" aria-hidden>
                  {p.emoji}
                </span>
                <Badge until={until} />
              </div>
              <h3>{p.name}</h3>
              <p className="plan-tagline">{p.tagline}</p>
              <div className="plan-price">
                <b>{fmtPrice(p.price)} ₸</b>
                <span>/мес</span>
              </div>
              <div className="plan-usd">≈ {p.usd} · {counts[p.code].toLocaleString('ru')} {plural(counts[p.code], 'рецепт', 'рецепта', 'рецептов')}</div>
              <ul className="plan-features">
                {p.features.filter((f) => accounts || !/отзыв/i.test(f)).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Cta p={p} current={until !== undefined} />
            </article>
          )
        })}
      </section>
      {email && anyCheckout && <p className="cta-hint center">При оплате укажите тот же e-mail, что в аккаунте: <b>{email}</b> — так доступ откроется автоматически.</p>}
      {!anyCheckout && (
        <p className="plans-soon">
          {freeMode
            ? 'Сейчас всё бесплатно: все рецепты и шеф-ассистент открыты без подписки. Тарифы заработают позже.'
            : configured
              ? 'Онлайн-оплата подключается — совсем скоро здесь появится кнопка оплаты. Бесплатные рецепты уже доступны.'
              : 'Онлайн-оплата появится после запуска сервера. Бесплатные рецепты уже доступны.'}
        </p>
      )}

      {/* ---- сравнение ---- */}
      <section className="cmp" aria-labelledby="cmp-title">
        <h2 id="cmp-title">Что входит</h2>
        <div className="cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr>
                <th scope="col" className="cmp-label">
                  <span className="sr-only">Возможность</span>
                </th>
                {PLANS.map((p) => (
                  <th key={p.code} scope="col" className={p.code === 'grandchef' ? 'gc' : ''}>
                    <span className="cmp-emoji" aria-hidden>
                      {p.emoji}
                    </span>
                    <span className="cmp-name">{p.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="cmp-label">
                  Рецептов
                </th>
                {PLANS.map((p) => (
                  <td key={p.code} className={'cmp-num' + (p.code === 'grandchef' ? ' gc' : '')}>
                    {counts[p.code].toLocaleString('ru')}
                  </td>
                ))}
              </tr>
              {ROWS.filter((r) => accounts || !/отзыв/i.test(r.label)).map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="cmp-label">
                    {r.label}
                    {r.note && <small>{r.note}</small>}
                  </th>
                  {PLANS.map((p) => (
                    <td key={p.code} className={p.code === 'grandchef' ? 'gc' : ''}>
                      {mark(r.on === 'all' || r.on.includes(p.code))}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="cmp-label">
                  Цена в месяц
                </th>
                {PLANS.map((p) => (
                  <td key={p.code} className={'cmp-num' + (p.code === 'grandchef' ? ' gc' : '')}>
                    {fmtPrice(p.price)} ₸
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- FAQ ---- */}
      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Частые вопросы</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  )
}
