import { useCallback, useEffect, useState } from 'react'
import { clearRecipeCache, shortMode } from '../data'
import { planByCode } from '../plans'
import { errText } from '../supa'
import { toast } from '../ui'
import { type Pending, pendingRecipes, reviewRecipe } from '../userRecipes'

const PLAN_CODES = ['pp', 'sweet', 'weekday', 'gourmet'] as const
const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Подсказка тарифа по категории — модератор может поменять. */
function guessPlans(p: Pending): string[] {
  const c = p.category
  if (c === 'Десерты' || c === 'Выпечка') return ['sweet']
  if (c === 'Мясо' || c === 'Рыба и морепродукты' || c === 'Курица и птица') return (p.minutes ?? 99) <= 30 ? ['gourmet', 'weekday'] : ['gourmet']
  if ((p.minutes ?? 99) <= 30) return ['weekday']
  return ['weekday', 'pp']
}

function Item({ p, onDone }: { p: Pending; onDone: (id: string) => void }) {
  const [plans, setPlans] = useState<string[]>(() => guessPlans(p))
  const [free, setFree] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [imgOk, setImgOk] = useState(true)

  const decide = async (approve: boolean) => {
    if (approve && !plans.length && !free) return toast('Выберите хотя бы один тариф или «Бесплатно»')
    if (!approve && !reason.trim()) return toast('Напишите причину — автор её увидит')
    setBusy(true)
    try {
      const rid = await reviewRecipe(p.id, approve, plans, free, approve ? null : reason.trim())
      clearRecipeCache()
      toast(approve ? `Опубликовано${rid ? ` · ${rid}` : ''}. Обновите каталог, чтобы увидеть рецепт.` : 'Рецепт отклонён')
      onDone(p.id)
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const a = p.author
  return (
    <article className="mod-item">
      <header className="mod-head">
        <div>
          <h3>{p.title}</h3>
          <small>
            {a?.name || a?.email || 'Автор'} · {fmtDate(p.created_at)}
          </small>
        </div>
        {p.image_url && imgOk && <img className="mod-img" src={p.image_url} alt="" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />}
      </header>
      <div className="mod-facts">
        <span>{p.category}</span>
        {p.mode && <span title={p.mode}>{shortMode(p.mode)}</span>}
        {p.temp_c && <span>{p.temp_c} °C</span>}
        {p.minutes && <span>{p.minutes} мин</span>}
        {p.servings && <span>{p.servings} порц.</span>}
        {p.image_url && !imgOk && <span className="mod-warn">фото не открывается</span>}
      </div>
      {p.intro && <p className="mod-intro">{p.intro}</p>}
      <div className="mod-body">
        <div>
          <h4>Ингредиенты · {p.ingredients.length}</h4>
          <ul>
            {p.ingredients.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Шаги · {p.steps.length}</h4>
          <ol>
            {p.steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="mod-decide">
        <div className="chips small" role="group" aria-label="Тарифы, которые открывают рецепт">
          {PLAN_CODES.map((c) => {
            const on = plans.includes(c)
            return (
              <button key={c} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setPlans((x) => (on ? x.filter((y) => y !== c) : [...x, c]))}>
                {planByCode(c)?.emoji} {planByCode(c)?.name}
              </button>
            )
          })}
          <button type="button" className={'chip' + (free ? ' on' : '')} aria-pressed={free} onClick={() => setFree((x) => !x)}>
            🎁 Бесплатно
          </button>
        </div>
        <small className="muted">«Шеф» и «Grand Chef» открывают все рецепты автоматически.</small>
        {rejecting ? (
          <div className="mod-reject">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина: например, не указан режим или это не рецепт для ГрандШефа" aria-label="Причина отказа" maxLength={300} autoFocus />
            <button className="btn danger" disabled={busy} onClick={() => decide(false)}>
              Отклонить
            </button>
            <button className="btn ghost" onClick={() => setRejecting(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <div className="mod-actions">
            <button className="btn primary" disabled={busy} onClick={() => decide(true)}>
              ✓ Одобрить и опубликовать
            </button>
            <button className="btn ghost danger" disabled={busy} onClick={() => setRejecting(true)}>
              Отклонить с причиной…
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export default function Moderation({ onCount }: { onCount?: (n: number) => void }) {
  const [list, setList] = useState<Pending[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    pendingRecipes()
      .then((l) => {
        setList(l)
        setErr(null)
      })
      .catch((e) => setErr(errText(e)))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (list) onCount?.(list.length)
  }, [list, onCount])

  if (err)
    return (
      <p className="form-err" role="alert">
        {err}
      </p>
    )
  if (!list) return <div className="skeleton sk-box" style={{ height: 200 }} />
  if (!list.length)
    return (
      <section className="adm-card mod-empty">
        <h2>Очередь пуста 👍</h2>
        <p className="muted">Новые рецепты от владельцев появятся здесь. Отправить тестовый можно на странице «Добавить рецепт».</p>
        <a className="btn" href="#/add">
          Добавить рецепт
        </a>
      </section>
    )
  return (
    <div className="mod-list">
      {list.map((p) => (
        <Item key={p.id} p={p} onDone={(id) => setList((l) => (l || []).filter((x) => x.id !== id))} />
      ))}
    </div>
  )
}
