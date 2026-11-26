import { useMemo, useState } from 'react'
import { CATEGORIES, imgUrl, MODES, type IndexItem, type Meta, plural } from '../data'
import { generate, SLOT_NAMES } from '../planner'
import { fmtPrice, planByCode } from '../plans'
import { useStore } from '../store'
import { canPlan, useAuth } from '../supa'
import { CrownIcon, go, InstallCard, RecipeCard } from '../ui'
import CollectionTiles from '../CollectionTiles'

function GrandChefBanner({ items }: { items: IndexItem[] }) {
  const { access } = useAuth()
  const mine = canPlan(access)
  const gc = planByCode('grandchef')!
  const day = useMemo(() => {
    const d = new Date()
    const p = generate(items, { goal: 'keep', kcal: 2000, people: 2, diet: 'any', exclude: '', weekdayMax: 40, desserts: true }, new Set(), d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate())
    return p.days[0]
  }, [items])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const kc = day.meals.reduce((a, m) => a + (byId.get(m.id)?.kc || 0), 0)
  return (
    <section className="gc-banner" aria-labelledby="gcb-title">
      <div className="gc-glow" aria-hidden />
      <div className="gcb-text">
        <span className="best-pill">
          <CrownIcon size={13} /> Grand Chef
        </span>
        <h2 id="gcb-title">Меню на неделю — за 2 секунды</h2>
        <p>
          Шеф-ассистент подберёт завтраки, обеды, ужины и десерты под вашу цель по калориям, без повторов. Объяснит, чем полезно каждое блюдо, и соберёт
          список покупок одной кнопкой.
        </p>
        <div className="gcb-actions">
          <a className="btn gold-btn" href="#/planner">
            {mine ? '✨ Составить меню' : '✨ Попробовать'}
          </a>
          {!mine && (
            <a className="gcb-link" href="#/plans">
              Тарифы · от {fmtPrice(planByCode('weekday')!.price)} ₸, Grand Chef — {fmtPrice(gc.price)} ₸/мес
            </a>
          )}
        </div>
      </div>
      <a className="gcb-day" href="#/planner" aria-label="Пример дня из меню">
        <div className="gcb-day-head">
          <b>Понедельник</b>
          <span>{kc.toLocaleString('ru')} ккал</span>
        </div>
        {day.meals.map((m) => {
          const it = byId.get(m.id)
          if (!it) return null
          return (
            <div key={m.slot} className="gcb-meal">
              {it.im ? <img src={imgUrl(it.id)} alt="" loading="lazy" decoding="async" /> : <span className="gcb-ph">🍽️</span>}
              <div>
                <small>{SLOT_NAMES[m.slot]}</small>
                <span>{it.t}</span>
              </div>
              <em>{it.kc}</em>
            </div>
          )
        })}
      </a>
    </section>
  )
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

function Row({ title, items, more }: { title: string; items: IndexItem[]; more?: string }) {
  if (!items.length) return null
  return (
    <section className="row">
      <div className="row-head">
        <h2>{title}</h2>
        {more && (
          <a className="link" href={more}>
            Все →
          </a>
        )}
      </div>
      <div className="row-scroll">
        {items.map((r) => (
          <RecipeCard key={r.id} r={r} />
        ))}
      </div>
    </section>
  )
}

export default function Home({ items, meta }: { items: IndexItem[]; meta: Meta }) {
  const [q, setQ] = useState('')
  const recent = useStore((s) => s.recent)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const catCount = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((i) => i.c.forEach((c) => m.set(c, (m.get(c) || 0) + 1)))
    return m
  }, [items])
  const modeCount = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((i) => i.m.forEach((c) => m.set(c, (m.get(c) || 0) + 1)))
    return m
  }, [items])
  const official = items.filter((i) => i.sk.includes('official') || i.sk.includes('app')).length

  const today = useMemo(() => {
    const d = new Date()
    const rnd = seeded(d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate())
    const pool = items.filter((i) => i.tr >= 75 && i.im)
    const pick: IndexItem[] = []
    while (pick.length < 4 && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
    return pick
  }, [items])

  const quick = useMemo(() => items.filter((i) => i.min && i.min <= 20 && i.im).sort((a, b) => b.vw - a.vw).slice(0, 14), [items])
  const popular = useMemo(() => [...items].sort((a, b) => b.vw - a.vw).slice(0, 14), [items])
  const fresh = useMemo(() => [...items].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 14), [items])
  const probe = useMemo(() => items.filter((i) => i.g.includes('Термощуп')).slice(0, 14), [items])
  const recentItems = recent.map((id) => byId.get(id)).filter(Boolean) as IndexItem[]

  const spin = () => {
    const pool = items.filter((i) => i.tr >= 60)
    const r = pool[Math.floor(Math.random() * pool.length)]
    if (r) go(`/r/${r.id}?roulette=1`)
  }

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">Рецепты для мультишефа-аэрогриля ГрандШеф</div>
          <h1>
            {meta.total.toLocaleString('ru')} {plural(meta.total, 'проверенный рецепт', 'проверенных рецепта', 'проверенных рецептов')} с точным режимом,
            температурой и временем
          </h1>
          <p className="hero-sub">
            Собраны из открытых источников. У каждого рецепта есть ссылка на оригинал и индекс проверенности. Выдуманных рецептов здесь нет.
          </p>
          <form
            className="search big"
            onSubmit={(e) => {
              e.preventDefault()
              go(`/catalog?q=${encodeURIComponent(q)}`)
            }}
          >
            <span className="search-ico">⌕</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например: крылышки, сырники, лосось с термощупом…" aria-label="Поиск рецептов" />
            <button className="btn primary">Найти</button>
          </form>
          <div className="hero-actions">
            <a className="btn ghost" href="#/fridge">
              🧊 Что есть в холодильнике?
            </a>
            <button className="btn ghost" onClick={spin}>
              🎲 Рулетка: удиви меня
            </button>
          </div>
          <div className="stats">
            <div>
              <b>{meta.total.toLocaleString('ru')}</b>
              <span>рецептов</span>
            </div>
            <div>
              <b>{official.toLocaleString('ru')}</b>
              <span>от бренда ГрандШеф</span>
            </div>
            <div>
              <b>{meta.sources.length}</b>
              <span>{plural(meta.sources.length, 'источник', 'источника', 'источников')}</span>
            </div>
          </div>
        </div>
        <div className="hero-today">
          <div className="today-title">Что приготовить сегодня</div>
          <div className="today-grid">
            {today.map((r) => (
              <RecipeCard key={r.id} r={r} />
            ))}
          </div>
        </div>
      </section>

      <GrandChefBanner items={items} />

      <section className="row">
        <div className="row-head">
          <h2>Каталог</h2>
          <a className="link" href="#/catalog">
            Все рецепты →
          </a>
        </div>
        <div className="cats">
          {CATEGORIES.filter((c) => catCount.get(c.name)).map((c) => (
            <a key={c.name} className="cat" href={`#/catalog?cat=${encodeURIComponent(c.name)}`}>
              <span className="cat-emoji">{c.emoji}</span>
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{catCount.get(c.name)} {plural(catCount.get(c.name)!, 'рецепт', 'рецепта', 'рецептов')}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="row">
        <div className="row-head">
          <h2>Подборки</h2>
          <a className="link" href="#/collections">
            Все подборки →
          </a>
        </div>
        <CollectionTiles items={items} />
      </section>

      <section className="row">
        <div className="row-head">
          <h2>По режиму ГрандШефа</h2>
          <a className="link" href="#/modes">
            Что умеет каждый режим →
          </a>
        </div>
        <div className="chips">
          {MODES.filter((m) => modeCount.get(m)).map((m) => (
            <a key={m} className="chip" href={`#/catalog?mode=${encodeURIComponent(m)}`}>
              {m} <small>{modeCount.get(m)}</small>
            </a>
          ))}
        </div>
      </section>

      {recentItems.length > 0 && <Row title="Вы недавно смотрели" items={recentItems.slice(0, 14)} />}
      <Row title="⚡ Быстро: до 20 минут" items={quick} more="#/catalog?max=20&sort=pop" />
      <Row title="🔥 Самые популярные" items={popular} more="#/catalog?sort=pop" />
      <Row title="🌡️ С термощупом — идеальная прожарка" items={probe} more="#/catalog?tag=Термощуп" />
      <Row title="🆕 Новые рецепты" items={fresh} more="#/catalog?sort=new" />
      <InstallCard />
    </div>
  )
}
