import { useMemo } from 'react'
import { imgUrl, type IndexItem, plural, shortMode } from '../data'

/** Что это за режим — общими словами. Цифры (температура, время) берём только из рецептов каталога. */
const ABOUT: Record<string, { emoji: string; text: string }> = {
  Аэрогриль: { emoji: '🌀', text: 'Горячий воздух на большой скорости: хрустящая корочка почти без масла. Крылышки, картофель, наггетсы, овощи.' },
  Выпечка: { emoji: '🥧', text: 'Ровный жар, как в духовке. Пироги, кексы, запеканки, хлеб — и многое из «духовочных» рецептов.' },
  Запекание: { emoji: '🍗', text: 'Для крупных кусков: птица, мясо, рыба и овощи целиком или ломтями — пропекаются насквозь.' },
  Гриль: { emoji: '🔥', text: 'Сильный жар для румяной корочки и полосок от решётки: стейки, котлеты, овощи гриль, подрумянивание.' },
  Барбекю: { emoji: '🍖', text: 'Высокая температура для мяса на решётке: шашлычки, рёбрышки, крылья в маринаде.' },
  Фритюр: { emoji: '🍟', text: 'Для блюд, которые обычно жарят во фритюре: закуски в панировке, чебуреки, пончики.' },
  'Су-вид': { emoji: '🌡️', text: 'Точная низкая температура несколько часов: мясо, птица и рыба остаются сочными по всей толщине.' },
  Пар: { emoji: '♨️', text: 'Готовка на пару: овощи, рыба, манты и паровые котлеты — без корочки и без масла.' },
  Томление: { emoji: '🍲', text: 'Долгое приготовление при умеренной температуре — мясо становится мягким, соус насыщенным.' },
  Дегидратор: { emoji: '🍎', text: 'Сушка при низкой температуре часами: фруктовые чипсы, пастила, вяленое мясо, сухарики.' },
  Рис: { emoji: '🍚', text: 'Для риса, круп и гарниров в чаше.' },
  Пицца: { emoji: '🍕', text: 'Высокая температура для тонкой хрустящей основы: пицца, лепёшки, хачапури.' },
  Ручной: { emoji: '🎛️', text: 'Свои температура и время — когда рецепт требует нестандартных настроек.' },
}

const q = (a: number[], x: number) => {
  if (!a.length) return null
  const s = [...a].sort((m, n) => m - n)
  return s[Math.floor(x * (s.length - 1))]
}
const range = (a: number | null, b: number | null, fmt: (n: number) => string) => (a === null || b === null ? null : a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`)

/** 20–35 мин; для долгих режимов — в часах: 2–4 ч. */
function timeRange(a: number, b: number) {
  if (b < 120) return a === b ? `${a} мин` : `${a}–${b} мин`
  const h = (x: number) => String(Math.round((x / 60) * 2) / 2).replace('.', ',')
  return h(a) === h(b) ? `≈ ${h(a)} ч` : `${h(a)}–${h(b)} ч`
}

export default function Modes({ items }: { items: IndexItem[] }) {
  const modes = useMemo(() => {
    const m = new Map<string, IndexItem[]>()
    for (const i of items) for (const x of i.m) m.set(x, [...(m.get(x) || []), i])
    return [...m.entries()]
      .filter(([, l]) => l.length >= 3)
      .map(([mode, list]) => {
        const tp = list.flatMap((i) => (i.tp ? [i.tp] : []))
        const mins = list.flatMap((i) => (i.min ? [i.min] : []))
        const cats = new Map<string, number>()
        list.forEach((i) => i.c.forEach((c) => cats.set(c, (cats.get(c) || 0) + 1)))
        const name = mode.includes(' / ') ? shortMode(mode) : mode
        return {
          mode,
          name,
          n: list.length,
          tp: tp.length >= 3 ? range(q(tp, 0.25), q(tp, 0.75), String) + ' °C' : null,
          min: mins.length >= 3 ? timeRange(q(mins, 0.25)!, q(mins, 0.75)!) : null,
          cats: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
          top: [...list].filter((i) => i.im).sort((a, b) => b.tr - a.tr || b.vw - a.vw).slice(0, 4),
          about: ABOUT[name],
        }
      })
      .sort((a, b) => b.n - a.n)
  }, [items])

  return (
    <div className="page modes">
      <h1>Режимы ГрандШефа</h1>
      <p className="muted">
        Для чего каждый режим и какие настройки чаще всего встречаются в рецептах каталога. Температура и время — типичный диапазон (середина половины
        рецептов), а не заводская инструкция: точные значения смотрите в конкретном рецепте.
      </p>
      <div className="mode-list">
        {modes.map((m) => (
          <section key={m.mode} className="mode-card">
            <div className="mode-head">
              <span className="mode-emoji" aria-hidden>
                {m.about?.emoji || '🍽️'}
              </span>
              <div>
                <h2>{m.name}</h2>
                <small>
                  {m.n.toLocaleString('ru')} {plural(m.n, 'рецепт', 'рецепта', 'рецептов')}
                </small>
              </div>
            </div>
            {m.about && <p className="mode-text">{m.about.text}</p>}
            <div className="mode-stats">
              {m.tp && (
                <div>
                  <span>Обычно</span>
                  <b>{m.tp}</b>
                </div>
              )}
              {m.min && (
                <div>
                  <span>Время</span>
                  <b>{m.min}</b>
                </div>
              )}
              {m.cats.length > 0 && (
                <div className="wide">
                  <span>Чаще всего</span>
                  <b>{m.cats.join(', ')}</b>
                </div>
              )}
            </div>
            {m.top.length > 0 && (
              <div className="mode-top">
                {m.top.map((i) => (
                  <a key={i.id} href={`#/r/${i.id}`} title={i.t}>
                    <img src={imgUrl(i.id)} alt={i.t} loading="lazy" decoding="async" />
                  </a>
                ))}
              </div>
            )}
            <a className="btn" href={`#/catalog?mode=${encodeURIComponent(m.mode)}`}>
              Все рецепты · {m.name} →
            </a>
          </section>
        ))}
      </div>
    </div>
  )
}
