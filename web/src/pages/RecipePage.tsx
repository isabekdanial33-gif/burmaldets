import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtMinutes, imgUrl, type IndexItem, loadRecipe, plural, type Recipe, stem, tokenize, trustLevel } from '../data'
import { fmtPrice, planByCode } from '../plans'
import { actions, useStore } from '../store'
import { accounts, canOpen, errCode, ERRORS, gated, isDevSim, useAuth } from '../supa'
import { findDurations, startTimer } from '../timers'
import { Empty, Grid, LockIcon, loginHref, toast, TrustBadge } from '../ui'
import Reviews from '../Reviews'
import VideoPlayer from '../VideoPlayer'
import { ShareSheet } from '../Share'
import { canListen, canSpeak, type Command, speak, stopSpeaking, useVoiceCommands } from '../voice'

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

function fmtNum(n: number) {
  if (n >= 10) return String(Math.round(n))
  const r = Math.round(n * 4) / 4
  const whole = Math.floor(r)
  const frac = r - whole
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''
  return (whole ? String(whole) : f ? '' : '0') + f || String(r)
}

/** Масштабирует количество в строке ингредиента: «Сыр — 50 г» ×2 → «Сыр — 100 г». */
export function scaleLine(line: string, k: number) {
  if (k === 1) return line
  const m = line.match(/^(.*?\s[—–-]\s)(.*)$/)
  if (!m) return line
  const qty = m[2].replace(/(\d+[.,]?\d*)\s*\/\s*(\d+)|(\d+[.,]?\d*)|([½¼¾⅓⅔])/g, (_all, a, b, c, f) => {
    let v: number
    if (a && b) v = parseFloat(a.replace(',', '.')) / parseFloat(b)
    else if (c) v = parseFloat(c.replace(',', '.'))
    else v = FRACTIONS[f]
    // не трогаем проценты, категории яиц, размеры формы
    return fmtNum(v * k)
  })
  if (/%|С0|С1|см\b|×/.test(m[2])) return line
  return m[1] + qty
}

/** Короткая строка-вопрос в шагах — подзаголовок совета автора, без номера шага. */
const isTipHeading = (s: string) => s.trim().length <= 90 && /\?\s*$/.test(s.trim())

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="r-section">
      <div className="r-section-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function StepText({ text, recipeTitle, idx, shown }: { text: string; recipeTitle: string; idx: number; shown?: string }) {
  const durs = findDurations(text)
  return (
    <>
      <p>{shown ?? text}</p>
      {durs.length > 0 && (
        <div className="step-timers">
          {durs.map((d, i) => (
            <button
              key={i}
              className="timer-btn"
              onClick={() => {
                startTimer(`${recipeTitle} · шаг ${idx + 1}`, d.seconds)
                toast(`Таймер на ${d.label} запущен`)
              }}
            >
              ⏱ {d.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ---------- защита от копирования ----------
let lastWarn = 0
const block = (e: React.SyntheticEvent) => {
  e.preventDefault()
  if (Date.now() - lastWarn > 2500) {
    lastWarn = Date.now()
    toast('Копирование отключено — поделитесь ссылкой')
  }
}
/** Обработчики для блоков с текстом рецепта: без копирования, контекстного меню и перетаскивания. */
const guard = { onCopy: block, onCut: block, onContextMenu: block, onDragStart: block }

/** Невидимый отпечаток: код wm в виде zero-width символов внутри текста первого шага. */
function fingerprint(text: string, wm: string) {
  const bits = [...wm].map((ch) => ch.charCodeAt(0).toString(2).padStart(8, '0')).join('')
  const code = '⁠' + [...bits].map((b) => (b === '1' ? '‌' : '​')).join('') + '⁠'
  const i = text.indexOf(' ')
  return i > 0 ? text.slice(0, i) + code + text.slice(i) : text + code
}

/** Плитка водяного знака: e-mail + код. Еле заметная, не мешает читать. */
function wmTile(text: string) {
  const esc = text.replace(/[<>&'"]/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170">` +
    `<text x="150" y="92" text-anchor="middle" transform="rotate(-24 150 85)" font-family="Manrope,Arial,sans-serif" font-size="13" font-weight="700" fill="#1e1a16" fill-opacity="0.075">${esc}</text></svg>`
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`
}

function CookMode({ r, onClose }: { r: Recipe; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [reading, setReading] = useState(false)
  const iRef = useRef(0)
  useEffect(() => {
    iRef.current = i
  }, [i])
  const n = r.steps.length

  const read = useCallback(
    (k: number) => {
      if (!canSpeak) return
      const text = k >= n ? 'Готово! Приятного аппетита.' : `Шаг ${k + 1}. ${r.steps[k]}`
      setReading(true)
      speak(text, () => setReading(false))
    },
    [r, n],
  )
  const go = useCallback(
    (k: number, say: boolean) => {
      const nx = Math.max(0, Math.min(n, k))
      setI(nx)
      if (say) read(nx)
      else if (canSpeak) {
        stopSpeaking()
        setReading(false)
      }
    },
    [n, read],
  )
  const onCommand = useCallback(
    (c: Command) => {
      const cur = iRef.current
      if (c.kind === 'next') go(cur + 1, true)
      else if (c.kind === 'prev') go(cur - 1, true)
      else if (c.kind === 'repeat') read(cur)
      else if (c.kind === 'stop') {
        stopSpeaking()
        setReading(false)
      } else if (c.kind === 'timer') {
        const d = c.seconds ? { seconds: c.seconds, label: fmtMinutes(Math.round(c.seconds / 60)) || `${c.seconds} сек` } : findDurations(r.steps[cur] || '')[0]
        if (!d) {
          toast('В этом шаге нет времени — скажите, например: «таймер 10 минут»')
          if (canSpeak) speak('Скажите, на сколько минут таймер')
          return
        }
        startTimer(`${r.title} · шаг ${cur + 1}`, d.seconds)
        toast(`Таймер на ${d.label} запущен`)
        if (canSpeak) speak(`Таймер на ${d.label} запущен`)
      }
    },
    [go, read, r],
  )
  const mic = useVoiceCommands(onCommand)

  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(iRef.current + 1, false)
      if (e.key === 'ArrowLeft') go(iRef.current - 1, false)
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    document.body.style.overflow = 'hidden'
    return () => {
      lock?.release().catch(() => {})
      window.removeEventListener('keydown', key)
      document.body.style.overflow = ''
      stopSpeaking()
    }
  }, [go, onClose])
  useEffect(() => {
    if (mic.error) toast(mic.error)
  }, [mic.error])

  const done = i >= n
  const meta = [r.modes_short.join(' · '), r.temp_text, r.time_text].filter(Boolean).join(' · ')
  return (
    <div className="cook" role="dialog" aria-modal="true" aria-label={`Режим готовки: ${r.title}`}>
      <div className="cook-top">
        <div className="cook-title">{r.title}</div>
        <div className="cook-tools">
          {canSpeak && (
            <button
              className={'icon-btn light' + (reading ? ' on' : '')}
              onClick={() => (reading ? (stopSpeaking(), setReading(false)) : read(i))}
              aria-label={reading ? 'Остановить озвучку' : 'Прочитать шаг вслух'}
              title={reading ? 'Остановить озвучку' : 'Прочитать шаг вслух'}
              aria-pressed={reading}
            >
              {reading ? '■' : '🔊'}
            </button>
          )}
          {canListen && (
            <button
              className={'icon-btn light mic-btn' + (mic.on ? ' on' : '')}
              onClick={mic.toggle}
              aria-pressed={mic.on}
              aria-label={mic.on ? 'Выключить голосовое управление' : 'Включить голосовое управление'}
              title={mic.on ? 'Выключить голосовое управление' : 'Голосом: «дальше», «назад», «повтори», «таймер»'}
            >
              🎙
            </button>
          )}
          <button className="icon-btn light" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
      </div>
      {mic.on && (
        <div className="voice-bar" aria-live="polite">
          <span className="voice-dot" aria-hidden />
          <span>
            Слушаю: <b>«дальше»</b>, <b>«назад»</b>, <b>«повтори»</b>, <b>«таймер»</b>
            {mic.heard && <em> · вы сказали: «{mic.heard}»</em>}
          </span>
        </div>
      )}
      <div className="cook-progress">
        {r.steps.map((_, k) => (
          <span key={k} className={k <= i ? 'on' : ''} onClick={() => go(k, false)} />
        ))}
      </div>
      <div className="cook-body">
        {done ? (
          <div className="cook-done">
            <div className="cook-big">🎉 Готово!</div>
            <p>Приятного аппетита. Отметить, что вы приготовили это блюдо?</p>
            <button
              className="btn primary"
              onClick={() => {
                actions.markCooked(r.id)
                toast('Добавлено в «Мой дневник»')
                onClose()
              }}
            >
              ✓ Я приготовил
            </button>
          </div>
        ) : (
          <>
            <div className="cook-step-n">
              Шаг {i + 1} из {n}
            </div>
            <div className="cook-step protected" {...guard}>
              <StepText text={r.steps[i]} recipeTitle={r.title} idx={i} />
            </div>
            {meta && <div className="cook-meta">{meta}</div>}
          </>
        )}
      </div>
      <div className="cook-nav">
        <button className="btn ghost light" disabled={i === 0} onClick={() => go(i - 1, false)}>
          ← Назад
        </button>
        {!done && (
          <button className="btn primary" onClick={() => go(i + 1, false)}>
            {i === n - 1 ? 'Завершить' : 'Дальше →'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- общие блоки шапки рецепта ----------
type FactT = { label: string; value: string; sub?: string }

function Facts({ facts }: { facts: FactT[] }) {
  if (!facts.length) return null
  return (
    <div className="r-facts">
      {facts.map((f) => (
        <div className="fact" key={f.label}>
          <span>{f.label}</span>
          <b>{f.value}</b>
          {f.sub && <small>{f.sub}</small>}
        </div>
      ))}
    </div>
  )
}

function Nutrition({ kc, p, f, c, per100 }: { kc: number | null; p: number | null; f: number | null; c: number | null; per100?: number | null }) {
  if (!kc) return null
  const pk = (p || 0) * 4
  const fk = (f || 0) * 9
  const ck = (c || 0) * 4
  const sum = pk + fk + ck || 1
  return (
    <div className="nutri" aria-label="Пищевая ценность на порцию">
      <div className="nutri-row">
        <div className="nutri-kc">
          <b>{kc}</b>
          <span>ккал</span>
        </div>
        <div className="nutri-m p">
          <b>{p ?? '—'}</b>
          <span>белки, г</span>
        </div>
        <div className="nutri-m f">
          <b>{f ?? '—'}</b>
          <span>жиры, г</span>
        </div>
        <div className="nutri-m c">
          <b>{c ?? '—'}</b>
          <span>углеводы, г</span>
        </div>
      </div>
      <div className="nutri-bar" aria-hidden>
        <i className="p" style={{ width: (pk / sum) * 100 + '%' }} />
        <i className="f" style={{ width: (fk / sum) * 100 + '%' }} />
        <i className="c" style={{ width: (ck / sum) * 100 + '%' }} />
      </div>
      <div className="nutri-note">
        На порцию · ≈ расчёт по ингредиентам{per100 ? ` · ${per100} ккал на 100 г` : ''}
      </div>
    </div>
  )
}

function Crumbs({ cats }: { cats: string[] }) {
  return (
    <nav className="crumbs" aria-label="Навигация">
      <a href="#/catalog">Каталог</a> /{' '}
      <span>
        {cats.map((c) => (
          <a key={c} href={`#/catalog?cat=${encodeURIComponent(c)}`}>
            {c}
          </a>
        ))}
      </span>
    </nav>
  )
}

function HeroImg({ item, title }: { item: IndexItem; title: string }) {
  return <div className="r-img">{item.im ? <img src={imgUrl(item.id)} alt={title} /> : <div className="card-ph big">🍽️</div>}</div>
}

const servingsText = (n: number | null, est: boolean) => (n ? (est ? '≈ ' : '') + Math.round(n * 10) / 10 : null)

function indexFacts(item: IndexItem): FactT[] {
  const out: FactT[] = []
  if (item.m.length) out.push({ label: 'Режим', value: item.m.slice(0, 2).join(', ') })
  if (item.tp) out.push({ label: 'Температура', value: `${item.tp} °C` })
  if (item.min) out.push({ label: 'Время', value: fmtMinutes(item.min)! })
  const s = servingsText(item.srv, !!item.srvE)
  if (s) out.push({ label: 'Порций', value: s, sub: item.srvE ? 'примерно' : undefined })
  return out
}

// ---------- пейволл ----------
function seeded(id: string) {
  let s = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Размытые строки-заглушки. Это НЕ текст рецепта — просто полоски разной длины. */
function FakeLines({ id, ing }: { id: string; ing: number }) {
  const rnd = seeded(id)
  const steps = 5 + Math.floor(rnd() * 3)
  return (
    <div className="r-body paywall-body" aria-hidden>
      <section className="r-section">
        <div className="r-section-head">
          <h2>Ингредиенты</h2>
          <span className="muted small">{ing} шт.</span>
        </div>
        {Array.from({ length: Math.min(Math.max(ing, 5), 14) }, (_, i) => (
          <div key={i} className="fake-ing">
            <span className="fake-box" />
            <span className="fake-line" style={{ width: 35 + rnd() * 50 + '%' }} />
          </div>
        ))}
      </section>
      <section className="r-section">
        <div className="r-section-head">
          <h2>Приготовление</h2>
        </div>
        {Array.from({ length: Math.min(Math.max(steps, 3), 8) }, (_, i) => (
          <div key={i} className="fake-step">
            <span className="fake-num">{i + 1}</span>
            <div>
              {(() => {
                const len = 2 + Math.floor(rnd() * 2)
                return Array.from({ length: len }, (_, j) => (
                  <span key={j} className="fake-line" style={{ width: j === len - 1 ? 30 + rnd() * 40 + '%' : 88 + rnd() * 12 + '%' }} />
                ))
              })()}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

function Unlock({ item, mode }: { item: IndexItem; mode: 'auth' | 'locked' }) {
  const { email } = useAuth()
  const codes = [...new Set([...item.pl, 'chef', 'grandchef'])]
  const plans = codes
    .map(planByCode)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((x, y) => x.price - y.price)
  const free = !!item.fr
  return (
    <div className="unlock" id="unlock" role="region" aria-label="Как открыть рецепт">
      <div className="unlock-ico">
        <LockIcon size={22} />
      </div>
      <h2>{free ? 'Бесплатный рецепт' : 'Откройте рецепт'}</h2>
      <p className="unlock-text">
        {free
          ? 'Войдите или зарегистрируйтесь — это бесплатно и займёт полминуты. Ингредиенты, шаги и таймеры откроются сразу.'
          : mode === 'auth'
            ? 'Ингредиенты и пошаговый рецепт доступны по подписке. Войдите и выберите тариф — рецепт входит в:'
            : 'Ингредиенты и пошаговый рецепт доступны в тарифах:'}
      </p>
      {!free && (
        <div className="unlock-plans">
          {plans.map((p) => (
            <a key={p.code} href="#/plans" className={'unlock-plan' + (p.code === 'grandchef' ? ' gold' : '')}>
              <span className="up-emoji" aria-hidden>
                {p.emoji}
              </span>
              <span className="up-name">
                <b>{p.name}</b>
                <small>{p.code === 'grandchef' ? 'все рецепты + меню на неделю' : p.code === 'chef' ? 'все рецепты каталога' : p.tagline}</small>
              </span>
              <span className="up-price">
                {fmtPrice(p.price)} ₸<small>/мес</small>
              </span>
            </a>
          ))}
        </div>
      )}
      <div className="unlock-actions">
        {free ? (
          <a className="btn primary" href={loginHref()}>
            Войти и открыть бесплатно
          </a>
        ) : (
          <>
            <a className="btn primary" href="#/plans">
              Выбрать тариф
            </a>
            {!email && (
              <a className="btn" href={loginHref()}>
                Войти
              </a>
            )}
          </>
        )}
      </div>
      {!free && <p className="unlock-fine">Без автопродления · доступ на 30 дней · оплата картой</p>}
    </div>
  )
}

function Paywall({ item, mode }: { item: IndexItem; mode: 'auth' | 'locked' }) {
  const fav = useStore((s) => s.fav.includes(item.id))
  const [sharing, setSharing] = useState(false)
  const closeShare = useCallback(() => setSharing(false), [])
  return (
    <article className="recipe">
      <div className="r-hero">
        <HeroImg item={item} title={item.t} />
        <div className="r-head">
          <Crumbs cats={item.c} />
          <h1>{item.t}</h1>
          <div className="r-badges">
            {item.fr ? <span className="free-chip static">Бесплатно</span> : <span className="lock-chip static"><LockIcon size={12} /> По подписке</span>}
            <TrustBadge score={item.tr} />
            {item.v ? <span className="chip tiny">▶ есть видео</span> : null}
          </div>
          <Facts facts={indexFacts(item)} />
          <Nutrition kc={item.kc} p={item.p} f={item.f} c={item.cb} />
          <p className="pw-teaser">
            {item.ing.length} {plural(item.ing.length, 'ингредиент', 'ингредиента', 'ингредиентов')} · пошаговый рецепт с таймерами · режим готовки и список
            покупок
          </p>
          <div className="r-actions">
            <button className="btn primary" onClick={() => document.getElementById('unlock')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              🔓 {item.fr ? 'Открыть бесплатно' : 'Открыть рецепт'}
            </button>
            <button className={'btn' + (fav ? ' on' : '')} onClick={() => actions.toggleFav(item.id)} aria-pressed={fav}>
              {fav ? '♥ В избранном' : '♡ В избранное'}
            </button>
            <button className="btn" onClick={() => setSharing(true)}>
              ↗ Поделиться
            </button>
          </div>
        </div>
      </div>
      {sharing && <ShareSheet item={item} onClose={closeShare} />}
      <div className="paywall-wrap">
        <FakeLines id={item.id} ing={item.ing.length} />
        <Unlock item={item} mode={mode} />
      </div>
    </article>
  )
}

const BLOCKED: Record<string, { icon: string; title: string }> = {
  too_many_devices: { icon: '📱', title: 'Слишком много устройств' },
  rate_limited: { icon: '⏳', title: 'Небольшая пауза' },
  temporarily_blocked: { icon: '🛡️', title: 'Доступ временно ограничен' },
}

function Blocked({ item, code, onRetry }: { item: IndexItem; code: string; onRetry: () => void }) {
  const b = BLOCKED[code] || { icon: '😕', title: 'Не удалось открыть рецепт' }
  return (
    <div className="blocked">
      <div className="blocked-card">
        <div className="blocked-ico" aria-hidden>
          {b.icon}
        </div>
        <h1>{b.title}</h1>
        <p>{ERRORS[code] || 'Проверьте интернет и попробуйте ещё раз.'}</p>
        {code === 'too_many_devices' && <p className="muted small">Устройство «освобождается» через 30 дней без входа. Если это ошибка — напишите нам, разберёмся.</p>}
        {code === 'rate_limited' && <p className="muted small">Уже открытые сегодня рецепты доступны без ограничений.</p>}
        <div className="blocked-actions">
          <button className="btn primary" onClick={onRetry}>
            Попробовать снова
          </button>
          <a className="btn" href="#/catalog">
            В каталог
          </a>
        </div>
        <div className="blocked-recipe">
          {item.im ? <img src={imgUrl(item.id)} alt="" /> : null}
          <span>{item.t}</span>
        </div>
      </div>
    </div>
  )
}

function RecipeSkeleton() {
  return (
    <div className="recipe" aria-busy="true" aria-label="Загружаем рецепт">
      <div className="r-hero">
        <div className="skeleton r-img-sk" />
        <div>
          <div className="skeleton sk-line sm" style={{ width: '30%' }} />
          <div className="skeleton sk-h1" />
          <div className="skeleton sk-h1" style={{ width: '60%' }} />
          <div className="sk-facts">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton sk-fact" />
            ))}
          </div>
          <div className="skeleton sk-box" />
        </div>
      </div>
    </div>
  )
}

// ---------- страница ----------
export default function RecipePage({ item, items }: { item: IndexItem | undefined; items: IndexItem[] }) {
  const { access, loaded, email } = useAuth()
  const [r, setR] = useState<Recipe | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [k, setK] = useState(1)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [cook, setCook] = useState(false)
  const [showTrust, setShowTrust] = useState(false)
  const [sharing, setSharing] = useState(false)
  const closeShare = useCallback(() => setSharing(false), [])
  const closeCook = useCallback(() => setCook(false), [])
  const fav = useStore((s) => (item ? s.fav.includes(item.id) : false))
  const cooked = useStore((s) => (item ? s.cooked[item.id] : undefined))
  const allowed = !!item && (!gated || (!!email && canOpen(access, item.pl, !!item.fr)))
  const accessKey = access.plans.join(',')

  useEffect(() => {
    setK(1)
    setChecked(new Set())
    setShowTrust(false)
    window.scrollTo(0, 0)
    if (item) actions.pushRecent(item.id)
  }, [item])

  useEffect(() => {
    setR(null)
    setErr(null)
    if (!item || (gated && !loaded) || !allowed) return
    let alive = true
    loadRecipe(item)
      .then((x) => alive && setR(x))
      .catch((e) => alive && setErr(errCode(e)))
    return () => {
      alive = false
    }
  }, [item, loaded, allowed, accessKey, email, retry])

  const similar = useMemo(() => {
    if (!item) return []
    const mine = new Set(item.ing.flatMap((x) => tokenize(x).map(stem)))
    const titleStems = new Set(tokenize(item.t).filter((w) => w.length > 3).map(stem))
    return items
      .filter((i) => i.id !== item.id)
      .map((i) => {
        let s = 0
        if (i.c[0] === item.c[0]) s += 3
        for (const w of tokenize(i.t)) if (titleStems.has(stem(w))) s += 4
        for (const x of i.ing) for (const w of tokenize(x)) if (mine.has(stem(w))) s += 0.5
        return [i, s] as const
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([i]) => i)
  }, [item, items])

  if (!item) return <Empty title="Рецепт не найден" text="Возможно, ссылка устарела." action={<a className="btn" href="#/catalog">В каталог</a>} />
  if (err === 'not_found') return <Empty title="Рецепт не найден" text="Возможно, его убрали из каталога." action={<a className="btn" href="#/catalog">В каталог</a>} />

  const similarRow = similar.length > 0 && (
    <section className="row">
      <div className="row-head">
        <h2>Похожие рецепты</h2>
      </div>
      <Grid items={similar} />
    </section>
  )

  if (gated && loaded && !allowed) {
    return (
      <>
        <Paywall item={item} mode={!email ? 'auth' : 'locked'} />
        {similarRow}
      </>
    )
  }
  if (err === 'auth_required' || err === 'locked') {
    return (
      <>
        <Paywall item={item} mode={err === 'auth_required' ? 'auth' : 'locked'} />
        {similarRow}
      </>
    )
  }
  if (err) return <Blocked item={item} code={err} onRetry={() => setRetry((x) => x + 1)} />
  if (!r) return <RecipeSkeleton />

  const level = trustLevel(r.trust)
  const groups: { g?: string; list: { t: string; i: number }[] }[] = []
  r.ingredients.forEach((ing, i) => {
    const last = groups[groups.length - 1]
    if (last && last.g === ing.g) last.list.push({ t: ing.t, i })
    else groups.push({ g: ing.g, list: [{ t: ing.t, i }] })
  })
  const src = r.sources[0]
  const wm = r.wm || (isDevSim ? 'dev' + item.id.slice(0, 7) : '')
  const wmText = [email, wm].filter(Boolean).join(' · ')
  const estServ = r.servings_estimated || !!item.srvE
  const n = r.nutrition
  const facts: FactT[] = []
  if (r.modes_short.length) facts.push({ label: 'Режим', value: r.modes_short.join(', '), sub: r.modes.join(' · ') })
  if (r.temp_text) facts.push({ label: 'Температура', value: r.temp_text })
  if (r.time_text || r.minutes) {
    // в источнике часто время только в приборе, а в карточке каталога — полное (с тестом, маринадом и т. п.)
    const total = item.min && r.minutes && item.min >= r.minutes + 10 ? fmtMinutes(item.min) : null
    facts.push({ label: 'Время', value: r.time_text || fmtMinutes(r.minutes)!, sub: total ? `всего ≈ ${total}` : undefined })
  }
  const serv = servingsText(r.servings ? r.servings * k : null, estServ)
  if (serv) facts.push({ label: 'Порций', value: serv, sub: estServ ? 'примерно' : undefined })

  const addToList = () => {
    const lines = r.ingredients.filter((_, i) => !checked.has(i)).map((x) => scaleLine(x.t, k))
    const added = actions.addShop(lines, r.title, r.id)
    toast(added ? `В список покупок: +${added}` : 'Уже в списке покупок')
  }

  return (
    <article className="recipe">
      <div className="r-hero">
        <HeroImg item={item} title={r.title} />
        <div className="r-head">
          <Crumbs cats={r.categories} />
          <h1>{r.title}</h1>
          {r.intro && <p className="r-intro">{r.intro}</p>}
          <Facts facts={facts} />
          <Nutrition
            kc={n?.kcal ?? item.kc}
            p={n?.p ?? item.p}
            f={n?.f ?? item.f}
            c={n?.c ?? item.cb}
            per100={n?.kcal100}
          />

          <div className={`trust-box ${level.cls}`}>
            <button className="trust-row" onClick={() => setShowTrust((s) => !s)} aria-expanded={showTrust}>
              <TrustBadge score={r.trust} big />
              <span className="trust-why">{showTrust ? 'Скрыть' : 'Почему такой балл?'}</span>
            </button>
            {showTrust && (
              <ul className="trust-parts">
                {r.trust_parts.map(([l, p]) => (
                  <li key={l}>
                    <span>{l}</span>
                    <b>+{p}</b>
                  </li>
                ))}
              </ul>
            )}
            {src && (
              <div className="trust-src">
                Источник:{' '}
                {src.url ? (
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.platform} · {src.name}
                  </a>
                ) : (
                  <b>{src.name}</b>
                )}
                {src.date && <span className="muted"> · {new Date(src.date).toLocaleDateString('ru')}</span>}
                {r.views && <span className="muted"> · 👁 {r.views}</span>}
                {r.sources.length > 1 && <span className="muted"> · ещё {r.sources.length - 1}</span>}
              </div>
            )}
          </div>

          <div className="r-actions">
            <button className="btn primary" onClick={() => setCook(true)}>
              👨‍🍳 Режим готовки
            </button>
            <button className={'btn' + (fav ? ' on' : '')} onClick={() => actions.toggleFav(r.id)} aria-pressed={fav}>
              {fav ? '♥ В избранном' : '♡ В избранное'}
            </button>
            <button className="btn" onClick={() => setSharing(true)}>
              ↗ Поделиться
            </button>
            {r.videos?.length ? (
              <button className="btn" onClick={() => document.getElementById('video')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                ▶ Видео
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="print-only">
        <b>{r.title}</b>
        <p>Печать рецептов отключена. Откройте рецепт в приложении MyGrandChef — там есть режим готовки и таймеры.</p>
      </div>

      {r.videos?.length ? (
        <section className="r-section r-video">
          <div className="r-section-head">
            <h2>Видео</h2>
          </div>
          <VideoPlayer videos={r.videos} title={r.title} />
        </section>
      ) : null}

      <div className="r-body protected" {...guard}>
        <Section
          title="Ингредиенты"
          right={
            <div className="scaler" role="group" aria-label="Пересчёт порций">
              {[0.5, 1, 1.5, 2, 3].map((v) => (
                <button key={v} className={k === v ? 'on' : ''} onClick={() => setK(v)} aria-pressed={k === v}>
                  ×{v}
                </button>
              ))}
            </div>
          }
        >
          <p className="hint">Отметьте то, что уже есть дома — остальное уйдёт в список покупок.</p>
          {groups.map((g, gi) => (
            <div key={gi} className="ing-group">
              {g.g && <div className="ing-g">{g.g}</div>}
              <ul className="ings">
                {g.list.map(({ t, i }) => (
                  <li key={i} className={checked.has(i) ? 'have' : ''}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked.has(i)}
                        onChange={() => {
                          const nx = new Set(checked)
                          if (nx.has(i)) nx.delete(i)
                          else nx.add(i)
                          setChecked(nx)
                        }}
                      />
                      <span>{scaleLine(t, k)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button className="btn wide" onClick={addToList}>
            🛒 Добавить в список покупок
          </button>
          {k !== 1 && <p className="hint">Количество пересчитано автоматически — время и температура не меняются, но при ×2 и больше проверьте, помещается ли всё в чашу 8 л.</p>}
        </Section>

        <Section title="Приготовление">
          <div className="steps-wrap">
            {wmText && <div className="wm-layer" style={{ backgroundImage: wmTile(wmText) }} aria-hidden />}
            <ol className="steps">
              {r.steps.map((s, i) => (
                // «Как придать шашлычкам аромат дымка?» — заголовок совета, а не шаг
                <li key={i} className={isTipHeading(s) ? 'step-q' : undefined}>
                  <StepText text={s} shown={i === 0 && wm ? fingerprint(s, wm) : undefined} recipeTitle={r.title} idx={i} />
                </li>
              ))}
            </ol>
          </div>
          <div className="cooked-box">
            {cooked ? (
              <>
                <div>
                  ✓ Вы готовили это {new Date(cooked.at).toLocaleDateString('ru')}.{' '}
                  <span className="stars">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button key={s} className={(cooked.rating || 0) >= s ? 'on' : ''} onClick={() => actions.markCooked(r.id, s)} aria-label={`${s} из 5`}>
                        ★
                      </button>
                    ))}
                  </span>
                </div>
                <textarea placeholder="Заметка для себя: что поменять в следующий раз…" defaultValue={cooked.note || ''} onBlur={(e) => actions.setNote(r.id, e.target.value)} aria-label="Заметка" />
                <button className="link" onClick={() => actions.unmarkCooked(r.id)}>
                  убрать отметку
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => (actions.markCooked(r.id), toast('Добавлено в «Мой дневник»'))}>
                ✓ Я приготовил это блюдо
              </button>
            )}
          </div>
        </Section>
      </div>

      {accounts && <Reviews recipeId={r.id} />}
      {similarRow}
      {cook && createPortal(<CookMode r={r} onClose={closeCook} />, document.body)}
      {sharing && <ShareSheet item={item} onClose={closeShare} />}
    </article>
  )
}
