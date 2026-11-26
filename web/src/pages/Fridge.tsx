import { useMemo, useState } from 'react'
import { fridgeMatch, fridgeVocab, isMinor, STAPLES } from '../fridge'
import type { IndexItem } from '../data'
import { actions, useStore } from '../store'
import { Empty, Grid } from '../ui'

export default function Fridge({ items }: { items: IndexItem[] }) {
  const have = useStore((s) => s.fridge)
  const staples = useStore((s) => s.staples)
  const [text, setText] = useState('')

  const vocab = useMemo(() => fridgeVocab(items), [items])
  const suggestions = useMemo(() => {
    const t = text.trim().toLowerCase()
    if (!t) return vocab.filter((v) => !have.includes(v)).slice(0, 18)
    return vocab.filter((v) => v.includes(t) && !have.includes(v)).slice(0, 12)
  }, [text, vocab, have])

  const add = (v: string) => {
    v = v.trim().toLowerCase()
    if (v && !have.includes(v)) actions.setFridge([...have, v])
    setText('')
  }

  const results = useMemo(() => fridgeMatch(items, have, staples), [items, have, staples])

  const byId = new Map(results.map((r) => [r.i.id, r]))

  return (
    <div className="fridge">
      <h1>🧊 Что приготовить из того, что есть?</h1>
      <p className="muted">Добавьте продукты — покажем рецепты, где не хватает меньше всего. Соль, чёрный перец, растительное масло, вода, специи и зелень считаются «всегда есть».</p>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          add(text)
        }}
      >
        <span className="search-ico">＋</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: куриное филе, картофель, сыр…" aria-label="Продукт" />
        <button className="btn primary">Добавить</button>
      </form>
      {have.length > 0 && (
        <div className="chips">
          {have.map((h) => (
            <button key={h} className="chip on" onClick={() => actions.setFridge(have.filter((x) => x !== h))}>
              {h} ✕
            </button>
          ))}
          <button className="link" onClick={() => actions.setFridge([])}>
            очистить
          </button>
        </div>
      )}
      <div className="staples">
        <span className="f-title">Ещё всегда есть дома:</span>
        <div className="chips small">
          {STAPLES.map((s) => (
            <button key={s.key} className={'chip' + (staples.includes(s.key) ? ' on' : '')} aria-pressed={staples.includes(s.key)} onClick={() => actions.toggleStaple(s.key)}>
              {staples.includes(s.key) ? '✓ ' : ''}
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chips suggest">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => add(s)}>
            + {s}
          </button>
        ))}
      </div>
      {have.length === 0 ? (
        <Empty title="Холодильник пока пуст" text="Нажмите на продукты выше или впишите свои." />
      ) : results.length === 0 ? (
        <Empty
          title="Совпадений нет"
          text={
            have.every(isMinor)
              ? 'Специи, сушёные травы и зелень не учитываются — добавьте основные продукты: мясо, овощи, яйца, сыр…'
              : 'Попробуйте добавить больше продуктов или написать их проще: «курица» вместо «куриное бедро без кожи».'
          }
        />
      ) : (
        <Grid
          items={results.map((r) => r.i)}
          extra={(i) => {
            const r = byId.get(i.id)!
            return r.missing.length === 0 ? (
              <span className="miss ok">Всё есть!</span>
            ) : (
              <span className="miss" title={'Не хватает: ' + r.missing.join(', ')}>
                Не хватает: {r.missing.slice(0, 2).join(', ')}
                {r.missing.length > 2 ? ` +${r.missing.length - 2}` : ''}
              </span>
            )
          }}
        />
      )}
    </div>
  )
}
