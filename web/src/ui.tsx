import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, fmtMinutes, imgUrl, type IndexItem, trustLevel } from './data'
import { actions, useStore } from './store'
import { promptInstall, useInstall } from './pwa'
import { canOpen, freeMode, gated, hasAll, hueOf, useAuth } from './supa'

export function useHash() {
  const [hash, setHash] = useState(() => location.hash || '#/')
  useEffect(() => {
    const f = () => setHash(location.hash || '#/')
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const [path, qs = ''] = hash.slice(1).split('?')
  return { path, params: new URLSearchParams(qs) }
}

export const go = (to: string) => {
  location.hash = to
}

/** Ссылка на вход с возвратом на текущую страницу. */
export const loginHref = (next = location.hash.slice(1) || '/') => '#/login?next=' + encodeURIComponent(next)

export function TrustBadge({ score, big }: { score: number; big?: boolean }) {
  const l = trustLevel(score)
  return (
    <span className={`trust ${l.cls}${big ? ' big' : ''}`} title={`Индекс проверенности ${score}/100`}>
      <svg viewBox="0 0 24 24" width={big ? 18 : 13} height={big ? 18 : 13} aria-hidden>
        <path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z" />
      </svg>
      {l.label} · {score}
    </span>
  )
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.7V19h-2v-1.3A2 2 0 0 1 12 14Z"
      />
    </svg>
  )
}

export function CrownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path fill="currentColor" d="M3 7.5 7.5 11 12 4l4.5 7L21 7.5 19 18H5L3 7.5ZM5 19.5h14V21H5v-1.5Z" />
    </svg>
  )
}

export function Avatar({ email, size = 32 }: { email: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.44, background: `hsl(${hueOf(email)} 52% 56%)` }} aria-hidden>
      {email.slice(0, 1).toUpperCase()}
    </span>
  )
}

const catEmoji = (c: string) => CATEGORIES.find((x) => x.name === c)?.emoji ?? '🍽️'

export function RecipeCard({ r, extra }: { r: IndexItem; extra?: React.ReactNode }) {
  const fav = useStore((s) => s.fav.includes(r.id))
  const cooked = useStore((s) => !!s.cooked[r.id])
  const { access } = useAuth()
  const locked = gated && !canOpen(access, r.pl, !!r.fr)
  const free = !!r.fr && !hasAll(access) && !freeMode
  return (
    <a className="card" href={`#/r/${r.id}`}>
      <div className="card-img">
        {r.im ? <img src={imgUrl(r.id)} alt="" loading="lazy" decoding="async" /> : <div className="card-ph">{catEmoji(r.c[0])}</div>}
        <button
          className={'fav-btn' + (fav ? ' on' : '')}
          aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
          aria-pressed={fav}
          onClick={(e) => {
            e.preventDefault()
            actions.toggleFav(r.id)
          }}
        >
          {fav ? '♥' : '♡'}
        </button>
        {free ? (
          <span className="free-chip">Бесплатно</span>
        ) : locked ? (
          <span className="lock-chip" title="Доступно по подписке" aria-label="Доступно по подписке">
            <LockIcon size={13} />
          </span>
        ) : null}
        {r.v ? <span className="video-chip">▶ видео</span> : null}
        {r.sk.includes('owner') && <span className="owner-chip">👨‍🍳 От владельца</span>}
        {cooked && <span className="cooked-chip">✓ готовил</span>}
      </div>
      <div className="card-body">
        <div className="card-title">{r.t}</div>
        {r.sub && <div className="card-sub">{r.sub}</div>}
        <div className="card-meta">
          {r.m[0] && <span className="mode-pill">{r.m[0]}</span>}
          {r.tp && <span>{r.tp}°C</span>}
          {r.min && <span>⏱ {fmtMinutes(r.min)}</span>}
        </div>
        <div className="card-foot">
          <TrustBadge score={r.tr} />
          {r.kc ? (
            <span className="kcal-pill" title="Калорийность одной порции (≈ расчёт по ингредиентам)">
              {r.kc} ккал
            </span>
          ) : null}
          {extra}
        </div>
      </div>
    </a>
  )
}

export function Grid({ items, extra }: { items: IndexItem[]; extra?: (r: IndexItem) => React.ReactNode }) {
  return (
    <div className="grid">
      {items.map((r) => (
        <RecipeCard key={r.id} r={r} extra={extra?.(r)} />
      ))}
    </div>
  )
}

export function SkeletonGrid({ n = 8 }: { n?: number }) {
  return (
    <div className="grid" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card sk-card">
          <div className="skeleton sk-img" />
          <div className="card-body">
            <div className="skeleton sk-line" style={{ width: '86%' }} />
            <div className="skeleton sk-line" style={{ width: '54%' }} />
            <div className="skeleton sk-line sm" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Empty({ title, text, action, icon = '🍳' }: { title: string; text?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null)
  const t = useRef<number | undefined>(undefined)
  useEffect(() => {
    const f = (e: Event) => {
      setMsg((e as CustomEvent).detail)
      clearTimeout(t.current)
      t.current = window.setTimeout(() => setMsg(null), 2400)
    }
    window.addEventListener('toast', f)
    return () => window.removeEventListener('toast', f)
  }, [])
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {msg && (
        <div className="toast" key={msg}>
          {msg}
        </div>
      )}
    </div>
  )
}
export const toast = (m: string) => window.dispatchEvent(new CustomEvent('toast', { detail: m }))

/** «Установить на главный экран»: кнопка (Chrome/Android) или подсказка для iPhone. Скрыта, если уже установлено. */
export function InstallCard() {
  const st = useInstall()
  if (st.installed || (!st.can && !st.ios)) return null
  return (
    <section className="install-card" aria-label="Установить приложение">
      <span className="install-ico" aria-hidden>
        📲
      </span>
      <div>
        <b>MyGrandChef на главном экране</b>
        <span>
          {st.can
            ? 'Открывается как приложение, без адресной строки. Каталог и фото работают даже без интернета.'
            : 'В Safari нажмите «Поделиться» ⬆︎ → «На экран „Домой“». Каталог и фото будут работать даже без интернета.'}
        </span>
      </div>
      {st.can && (
        <button className="btn primary" onClick={() => promptInstall().then((ok) => ok && toast('Готово — ищите MyGrandChef на главном экране'))}>
          Установить
        </button>
      )}
    </section>
  )
}
