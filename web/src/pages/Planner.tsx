import { useEffect, useMemo, useRef, useState } from 'react'
import { imgUrl, type IndexItem, loadRecipe, plural } from '../data'
import {
  calcKcal,
  DAY_NAMES,
  type Day,
  dayTotals,
  type Diet,
  generate,
  type Goal,
  macroTargets,
  type Meal,
  type Settings,
  type Slot,
  SLOT_NAMES,
  swapMeal,
  type WeekPlan,
} from '../planner'
import { fmtPrice, planByCode } from '../plans'
import { actions } from '../store'
import { canPlan, configured, devMode, errCode, ERRORS, freeMode, sb, useAuth } from '../supa'
import { CrownIcon, go, LockIcon, loginHref, toast } from '../ui'
import { scaleLine } from './RecipePage'

// ---------- хранение ----------
type Calc = {
  sex: 'm' | 'f'
  weight: number
  height: number
  age: number
  activity: number
}
type Stored = {
  settings: Settings
  kcalMode: 'manual' | 'calc'
  calc: Calc
  current: WeekPlan | null
  saved: (WeekPlan & { savedAt: string })[]
}
const SKEY = 'mgc:planner:v1'
const DEFAULTS: Stored = {
  settings: {
    goal: 'keep',
    kcal: 2000,
    people: 2,
    diet: 'any',
    exclude: '',
    weekdayMax: 40,
    desserts: true,
  },
  kcalMode: 'manual',
  calc: { sex: 'f', weight: 65, height: 168, age: 32, activity: 1.375 },
  current: null,
  saved: [],
}
function loadStored(): Stored {
  try {
    const x = JSON.parse(localStorage.getItem(SKEY) || 'null')
    return x
      ? {
          ...DEFAULTS,
          ...x,
          settings: { ...DEFAULTS.settings, ...x.settings },
          calc: { ...DEFAULTS.calc, ...x.calc },
        }
      : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

// ---------- лимит генераций ----------
const LIMIT = 100
const CKEY = 'mgc:planner-credits'
const monthKey = () => new Date().toISOString().slice(0, 7)
function localUsed() {
  try {
    const x = JSON.parse(localStorage.getItem(CKEY) || 'null')
    return x?.m === monthKey() ? (x.used as number) : 0
  } catch {
    return 0
  }
}
async function fetchUsed(): Promise<number | null> {
  if (!configured) return localUsed()
  const { data, error } = await (await sb()).rpc('planner_status')
  return error || !data ? null : (data as { used: number }).used
}
/** Списывает одну генерацию. На сервере — consume_planner_credit; в dev без сервера — локальный счётчик. */
async function consume(): Promise<number> {
  if (!configured) {
    const u = localUsed()
    if (u >= LIMIT && !freeMode) throw new Error('planner_limit')
    localStorage.setItem(CKEY, JSON.stringify({ m: monthKey(), used: u + 1 }))
    return u + 1
  }
  const { data, error } = await (await sb()).rpc('consume_planner_credit')
  if (error) throw error
  return (data as { used: number }).used
}

// ---------- цели БЖУ ----------
const targets = (s: Settings) => macroTargets(s)
const GOALS: [Goal, string, string][] = [
  ['lose', 'Похудение', '−15% калорий'],
  ['keep', 'Поддержание', 'норма'],
  ['gain', 'Набор', '+12% калорий'],
]
const DIETS: [Diet, string][] = [
  ['any', 'Любая'],
  ['pp', 'ПП'],
  ['veg', 'Вегетарианская'],
  ['nopork', 'Без свинины'],
]
const ACTIVITY: [number, string][] = [
  [1.2, 'Сидячий образ жизни'],
  [1.375, 'Лёгкая активность (1–3 тренировки)'],
  [1.55, 'Средняя (3–5 тренировок)'],
  [1.725, 'Высокая (6–7 тренировок)'],
  [1.9, 'Очень высокая (физическая работа)'],
]
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const planIds = (p: WeekPlan) => p.days.flatMap((d) => d.meals.map((m) => m.id))

// ---------- части интерфейса ----------
function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l, sub]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
          {sub && <small>{sub}</small>}
        </button>
      ))}
    </div>
  )
}

/** upOk — перебор до +40% не считается проблемой (белок «с запасом» — это нормально). */
function Bar({ label, v, target, unit, upOk }: { label: string; v: number; target: number; unit: string; upOk?: boolean }) {
  const r = target ? v / target : 0
  const cls = Math.abs(r - 1) <= 0.12 || (upOk && r > 1 && r <= 1.4) ? 'ok' : r < 1 ? 'low' : 'high'
  return (
    <div className={'tbar ' + cls}>
      <div className="tbar-top">
        <span>{label}</span>
        <b>
          {Math.round(v)}
          <small>
            {' '}
            / {target} {unit}
          </small>
        </b>
      </div>
      <div className="tbar-track">
        <i style={{ width: Math.min(100, r * 100) + '%' }} />
      </div>
    </div>
  )
}

function Totals({ day, byId, s }: { day: Day; byId: Map<string, IndexItem>; s: Settings }) {
  const t = dayTotals(byId, day)
  const tg = targets(s)
  return (
    <div className="totals">
      <Bar label="Калории" v={t.kc} target={tg.kc} unit="ккал" />
      <Bar label="Белки" v={t.p} target={tg.p} unit="г" upOk />
      <Bar label="Жиры" v={t.f} target={tg.f} unit="г" />
      <Bar label="Углеводы" v={t.c} target={tg.c} unit="г" />
    </div>
  )
}

function MealCard({ meal, item, onSwap, blurred }: { meal: Meal; item: IndexItem | undefined; onSwap?: () => void; blurred?: boolean }) {
  const [more, setMore] = useState(false)
  if (!item) return <div className="meal empty-meal">Нет подходящего блюда</div>
  const why = more ? meal.why : meal.why.slice(0, 2)
  const Tag = blurred ? 'div' : 'a'
  return (
    <div className="meal">
      <Tag className="meal-img" {...(blurred ? {} : { href: `#/r/${item.id}` })}>
        {item.im ? <img src={imgUrl(item.id)} alt="" loading="lazy" decoding="async" /> : <span className="meal-ph">🍽️</span>}
        <span className="meal-slot">{SLOT_NAMES[meal.slot]}</span>
      </Tag>
      <div className="meal-body">
        <Tag className="meal-title" {...(blurred ? {} : { href: `#/r/${item.id}` })}>
          {item.t}
        </Tag>
        <div className="meal-macros">
          <b>{item.kc} ккал</b>
          <span>Б {item.p ?? '—'}</span>
          <span>Ж {item.f ?? '—'}</span>
          <span>У {item.cb ?? '—'}</span>
        </div>
        {meal.why.length > 0 && (
          <ul className="why" aria-label="Почему полезно">
            {why.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {meal.why.length > 2 && !more && (
              <li className="why-more">
                <button type="button" onClick={() => setMore(true)}>
                  ещё {meal.why.length - 2}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {onSwap && (
        <button type="button" className="swap-btn" onClick={onSwap} aria-label={`Заменить: ${item.t}`} title="Заменить блюдо — бесплатно">
          🔄
        </button>
      )}
    </div>
  )
}

function Week({ plan, byId, onSwap, blurred }: { plan: WeekPlan; byId: Map<string, IndexItem>; onSwap?: (d: number, s: Slot) => void; blurred?: boolean }) {
  const [day, setDay] = useState(0)
  useEffect(() => setDay(0), [plan.createdAt])
  return (
    <div className={'week' + (blurred ? ' blurred' : '')}>
      <div className="day-tabs" role="tablist" aria-label="Дни недели">
        {plan.days.map((d, i) => (
          <button key={i} role="tab" aria-selected={day === i} className={day === i ? 'on' : ''} onClick={() => setDay(i)}>
            <b>{DAY_SHORT[i]}</b>
            <small>{Math.round(dayTotals(byId, d).kc)}</small>
          </button>
        ))}
      </div>
      {plan.days.map((d, i) => (
        <section key={i} className={'day-row' + (day === i ? ' on' : '')} aria-label={DAY_NAMES[i]}>
          <div className="day-side">
            <h3>
              {DAY_NAMES[i]}
              {i >= 5 && <span className="wkend">выходной</span>}
            </h3>
            <Totals day={d} byId={byId} s={plan.settings} />
          </div>
          <div className="day-meals" style={{ '--n': d.meals.length || 1 } as React.CSSProperties}>
            {d.meals.map((m) => (
              <MealCard key={m.slot} meal={m} item={byId.get(m.id)} blurred={blurred} onSwap={onSwap ? () => onSwap(i, m.slot) : undefined} />
            ))}
            {d.meals.length === 0 && <div className="meal empty-meal">Не нашлось подходящих блюд — ослабьте фильтры</div>}
          </div>
        </section>
      ))}
    </div>
  )
}

// ---------- промо для тех, у кого нет Grand Chef ----------
function Promo({ items, byId }: { items: IndexItem[]; byId: Map<string, IndexItem> }) {
  const { email } = useAuth()
  const gc = planByCode('grandchef')!
  const sample = useMemo(() => {
    const p = generate(items, DEFAULTS.settings, new Set(), 20261122)
    return { ...p, days: p.days.slice(0, 3) }
  }, [items])
  return (
    <div className="planner promo">
      <section className="pl-hero">
        <div className="pl-hero-glow" aria-hidden />
        <span className="best-pill">
          <CrownIcon size={13} /> Только в Grand Chef
        </span>
        <h1>Шеф-ассистент составит меню на неделю за вас</h1>
        <p>Завтрак, обед, ужин и десерт на 7 дней — под вашу цель по калориям, без повторов и с объяснением, чем полезно каждое блюдо. Список покупок — одной кнопкой.</p>
        <div className="pl-hero-actions">
          <a className="btn gold-btn" href="#/plans">
            Открыть Grand Chef · {fmtPrice(gc.price)} ₸/мес
          </a>
          {!email && (
            <a className="btn ghost light" href={loginHref()}>
              У меня уже есть — войти
            </a>
          )}
        </div>
        <div className="pl-feats">
          <div>
            <b>🎯</b>
            <span>Цель по калориям и БЖУ — похудение, поддержание или набор</span>
          </div>
          <div>
            <b>🔁</b>
            <span>Без повторов внутри недели и с прошлыми меню</span>
          </div>
          <div>
            <b>💡</b>
            <span>«Почему полезно» — коротко про белок, клетчатку и режим</span>
          </div>
          <div>
            <b>🛒</b>
            <span>Покупки на всю неделю в один список</span>
          </div>
        </div>
      </section>

      <section className="sample">
        <div className="row-head">
          <h2>Пример меню</h2>
          <span className="muted small">2 000 ккал · 2 человека · любая диета</span>
        </div>
        <div className="sample-wrap">
          <Week plan={sample} byId={byId} blurred />
          <div className="sample-lock">
            <div className="unlock-ico">
              <LockIcon size={22} />
            </div>
            <h3>Ваше меню — за пару секунд</h3>
            <p>Укажите цель и предпочтения, а шеф-ассистент подберёт блюда из {items.length.toLocaleString('ru')} проверенных рецептов.</p>
            <a className="btn gold-btn" href="#/plans">
              Попробовать с Grand Chef
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------- сам ассистент ----------
function Assistant({ items, byId }: { items: IndexItem[]; byId: Map<string, IndexItem> }) {
  const init = useMemo(loadStored, [])
  const [settings, setSettings] = useState<Settings>(init.settings)
  const [kcalMode, setKcalMode] = useState(init.kcalMode)
  const [calc, setCalc] = useState<Calc>(init.calc)
  const [plan, setPlan] = useState<WeekPlan | null>(init.current)
  const [saved, setSaved] = useState(init.saved)
  const [used, setUsed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(!init.current)
  const [exText, setExText] = useState('')
  const [shopProg, setShopProg] = useState<{
    done: number
    total: number
  } | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchUsed().then(setUsed)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(SKEY, JSON.stringify({ settings, kcalMode, calc, current: plan, saved }))
    } catch {
      /* переполнено — не страшно */
    }
  }, [settings, kcalMode, calc, plan, saved])

  const effKcal = kcalMode === 'calc' ? calcKcal(calc.sex, calc.weight, calc.height, calc.age, calc.activity, settings.goal) : settings.kcal
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }))
  const excludes = settings.exclude
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const addEx = (v: string) => {
    const t = v.trim().toLowerCase()
    if (t && !excludes.includes(t)) set({ exclude: [...excludes, t].join(', ') })
    setExText('')
  }
  const history = useMemo(() => new Set([...saved.flatMap(planIds), ...(plan ? planIds(plan) : [])]), [saved, plan])
  // в бесплатном режиме генерации без ограничений
  const left = freeMode ? Infinity : used === null ? null : Math.max(0, LIMIT - used)

  const run = async () => {
    if (!(effKcal >= 1000 && effKcal <= 5000)) {
      setError('Укажите калории от 1 000 до 5 000 в день')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const u = await consume()
      setUsed(u)
      const s: Settings = { ...settings, kcal: effKcal }
      await new Promise((r) => setTimeout(r, 450)) // короткая пауза — чтобы было видно, что меню собирается
      const p = generate(items, s, history, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0)
      setPlan(p)
      setShowSettings(false)
      const meals = p.days.reduce((a, d) => a + d.meals.length, 0)
      if (meals < 7 * (s.desserts ? 4 : 3)) toast('Подходящих блюд мало — часть слотов пустая. Ослабьте фильтры.')
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          }),
        60,
      )
    } catch (e) {
      const c = errCode(e)
      setError(c === 'unknown' ? 'Не получилось сгенерировать меню. Проверьте интернет и попробуйте ещё раз.' : ERRORS[c])
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!plan) return
    if (saved.some((x) => x.createdAt === plan.createdAt)) return toast('Это меню уже сохранено')
    setSaved((s) => [{ ...plan, savedAt: new Date().toISOString() }, ...s].slice(0, 12))
    toast('Меню сохранено — в следующих генерациях эти блюда будут реже')
  }

  const shop = async () => {
    if (!plan || shopProg) return
    const ids = [...new Set(planIds(plan))]
    setShopProg({ done: 0, total: ids.length })
    const lines: string[] = []
    let failed = 0
    let done = 0
    const people = plan.settings.people
    const one = async (id: string) => {
      const it = byId.get(id)
      if (!it) return
      try {
        const r = await loadRecipe(it)
        const srv = r.servings || it.srv || people
        const k = Math.max(0.5, Math.round((people / srv) * 2) / 2)
        r.ingredients.forEach((x) => lines.push(scaleLine(x.t, k)))
      } catch {
        failed++
      } finally {
        done++
        setShopProg({ done, total: ids.length })
      }
    }
    for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(one))
    // одинаковые строки с количеством — складываем в «×2», «по вкусу» — оставляем одну
    const cnt = new Map<string, number>()
    lines.forEach((l) => cnt.set(l, (cnt.get(l) || 0) + 1))
    const out = [...cnt.entries()].map(([l, n]) => (n > 1 && /\d/.test(l) ? `${l} ×${n}` : l))
    const added = actions.addShop(out, 'Меню на неделю')
    setShopProg(null)
    toast(failed ? `Добавлено ${added}, не загрузилось блюд: ${failed}` : `В список покупок: +${added}`)
    if (added) setTimeout(() => go('/list'), 900)
  }

  const avg = plan ? Math.round(plan.days.reduce((a, d) => a + dayTotals(byId, d).kc, 0) / 7) : 0
  const goalName = (g: Goal) => GOALS.find((x) => x[0] === g)![1]

  return (
    <div className="planner">
      <header className="pl-head">
        <div>
          <span className="best-pill">
            <CrownIcon size={13} /> Grand Chef
          </span>
          <h1>Шеф-ассистент</h1>
          <p className="muted">Меню на неделю под вашу цель — из проверенных рецептов для ГрандШефа.</p>
        </div>
        {freeMode ? (
          <div className="credits" aria-live="polite">
            <div className="credits-top">
              <span>Генерации</span>
              <b>∞ без ограничений</b>
            </div>
            <small>Сейчас ассистент бесплатный для всех</small>
          </div>
        ) : (
          <div className="credits" aria-live="polite">
            <div className="credits-top">
              <span>Генерации в этом месяце</span>
              <b>{used === null ? '…' : `${used} из ${LIMIT}`}</b>
            </div>
            <div className="credits-track">
              <i style={{ width: ((used || 0) / LIMIT) * 100 + '%' }} />
            </div>
            <small>{devMode ? 'Локальный тест: счётчик хранится в браузере' : 'Замена отдельных блюд 🔄 — бесплатно'}</small>
          </div>
        )}
      </header>

      {plan && !showSettings ? (
        <div className="pl-summary">
          <div>
            <b>{goalName(plan.settings.goal)}</b> · {plan.settings.kcal.toLocaleString('ru')} ккал/день · {plan.settings.people}{' '}
            {plural(plan.settings.people, 'человек', 'человека', 'человек')}
            {plan.settings.diet !== 'any' && <> · {DIETS.find((d) => d[0] === plan.settings.diet)![1]}</>}
            {!plan.settings.desserts && <> · без десертов</>}
          </div>
          <button className="btn ghost" onClick={() => setShowSettings(true)}>
            ⚙ Изменить настройки
          </button>
        </div>
      ) : (
        <section className="pl-settings" aria-label="Настройки меню">
          <div className="ps-block">
            <div className="ps-title">Цель</div>
            <Seg label="Цель" value={settings.goal} options={GOALS} onChange={(goal) => set({ goal })} />
          </div>

          <div className="ps-block">
            <div className="ps-title">
              Калории в день
              <div className="mini-tabs" role="tablist">
                <button role="tab" aria-selected={kcalMode === 'manual'} className={kcalMode === 'manual' ? 'on' : ''} onClick={() => setKcalMode('manual')}>
                  Вручную
                </button>
                <button role="tab" aria-selected={kcalMode === 'calc'} className={kcalMode === 'calc' ? 'on' : ''} onClick={() => setKcalMode('calc')}>
                  Рассчитать
                </button>
              </div>
            </div>
            {kcalMode === 'manual' ? (
              <div className="kcal-manual">
                <input type="range" min={1200} max={4000} step={50} value={settings.kcal} onChange={(e) => set({ kcal: Number(e.target.value) })} aria-label="Калории в день" />
                <label className="num-in">
                  <input type="number" min={1000} max={5000} step={50} value={settings.kcal} onChange={(e) => set({ kcal: Number(e.target.value) })} aria-label="Калории, число" />
                  <span>ккал</span>
                </label>
              </div>
            ) : (
              <div className="kcal-calc">
                <Seg
                  label="Пол"
                  value={calc.sex}
                  options={[
                    ['f', 'Женщина'],
                    ['m', 'Мужчина'],
                  ]}
                  onChange={(sex) => setCalc((c) => ({ ...c, sex }))}
                />
                <div className="calc-row">
                  {(
                    [
                      ['weight', 'Вес, кг', 35, 250],
                      ['height', 'Рост, см', 120, 230],
                      ['age', 'Возраст', 14, 100],
                    ] as const
                  ).map(([k, l, mn, mx]) => (
                    <label key={k} className="field">
                      <span>{l}</span>
                      <input
                        type="number"
                        min={mn}
                        max={mx}
                        value={calc[k]}
                        onChange={(e) =>
                          setCalc((c) => ({
                            ...c,
                            [k]: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>Активность</span>
                  <select
                    value={calc.activity}
                    onChange={(e) =>
                      setCalc((c) => ({
                        ...c,
                        activity: Number(e.target.value),
                      }))
                    }
                  >
                    {ACTIVITY.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="calc-out">
                  ≈ <b>{effKcal.toLocaleString('ru')}</b> ккал в день <small>по формуле Миффлина — Сан-Жеора, с учётом цели</small>
                </div>
              </div>
            )}
          </div>

          <div className="ps-grid">
            <div className="ps-block">
              <div className="ps-title">Сколько человек</div>
              <div className="stepper">
                <button type="button" onClick={() => set({ people: Math.max(1, settings.people - 1) })} aria-label="Меньше" disabled={settings.people <= 1}>
                  −
                </button>
                <b aria-live="polite">{settings.people}</b>
                <button type="button" onClick={() => set({ people: Math.min(10, settings.people + 1) })} aria-label="Больше" disabled={settings.people >= 10}>
                  +
                </button>
              </div>
              <small className="muted">для пересчёта списка покупок</small>
            </div>
            <div className="ps-block">
              <div className="ps-title">Время в будни</div>
              <Seg
                label="Максимум минут в будни"
                value={settings.weekdayMax}
                options={[
                  [20, '20'],
                  [30, '30'],
                  [40, '40'],
                  [60, '60'],
                  [120, 'любое'],
                ]}
                onChange={(weekdayMax) => set({ weekdayMax })}
              />
              <small className="muted">минут на блюдо, в выходные — без ограничений</small>
            </div>
          </div>

          <div className="ps-block">
            <div className="ps-title">Питание</div>
            <div className="chips">
              {DIETS.map(([d, l]) => (
                <button key={d} type="button" className={'chip' + (settings.diet === d ? ' on' : '')} aria-pressed={settings.diet === d} onClick={() => set({ diet: d })}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="ps-block">
            <div className="ps-title">Исключить продукты</div>
            <div className="tag-input">
              {excludes.map((x) => (
                <button key={x} type="button" className="chip on tiny" onClick={() => set({ exclude: excludes.filter((y) => y !== x).join(', ') })} aria-label={`Убрать ${x}`}>
                  {x} ✕
                </button>
              ))}
              <input
                value={exText}
                onChange={(e) => setExText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addEx(exText)
                  } else if (e.key === 'Backspace' && !exText && excludes.length) set({ exclude: excludes.slice(0, -1).join(', ') })
                }}
                onBlur={() => exText && addEx(exText)}
                placeholder={excludes.length ? 'ещё…' : 'грибы, лук, рыба… (Enter — добавить)'}
                aria-label="Исключить продукт"
              />
            </div>
          </div>

          <label className="switch-row">
            <span>
              <b>Десерты</b>
              <small>небольшая порция сладкого каждый день — легче держать режим</small>
            </span>
            <input type="checkbox" role="switch" checked={settings.desserts} onChange={(e) => set({ desserts: e.target.checked })} />
            <i className="switch" aria-hidden />
          </label>

          <div className="ps-go">
            <button className="btn gold-btn big" onClick={run} disabled={busy || left === 0}>
              {busy ? (
                <>
                  <span className="spin" aria-hidden /> Шеф составляет меню…
                </>
              ) : plan ? (
                '✨ Сгенерировать новое меню'
              ) : (
                '✨ Сгенерировать меню'
              )}
            </button>
            {plan && (
              <button className="btn ghost" onClick={() => setShowSettings(false)}>
                Отмена
              </button>
            )}
            <span className="muted small">{left === null || left === Infinity ? '' : left === 0 ? 'Лимит на этот месяц исчерпан' : `спишется 1 из ${left} оставшихся`}</span>
          </div>
          {error && (
            <p className="form-err" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <div ref={resultRef} className="pl-result">
        {plan ? (
          <>
            <div className="pl-toolbar">
              <div className="pl-avg">
                <span>В среднем за день</span>
                <b>
                  {avg.toLocaleString('ru')} <small>/ {plan.settings.kcal.toLocaleString('ru')} ккал</small>
                </b>
              </div>
              <div className="pl-actions">
                <button className="btn primary" onClick={shop} disabled={!!shopProg}>
                  {shopProg ? `Собираем… ${shopProg.done}/${shopProg.total}` : '🛒 Список покупок на неделю'}
                </button>
                <button className="btn" onClick={save}>
                  💾 Сохранить меню
                </button>
                {!showSettings && (
                  <button className="btn ghost" onClick={run} disabled={busy || left === 0}>
                    {busy ? 'Составляем…' : '✨ Новое меню'}
                  </button>
                )}
              </div>
            </div>
            <Week plan={plan} byId={byId} onSwap={(d, s) => setPlan((p) => (p ? swapMeal(items, p, d, s, history) : p))} />
            <p className="muted small pl-note">
              КБЖУ — на одну порцию, ≈ расчёт по ингредиентам. Меню — подсказка, а не медицинская рекомендация: при особых диетах посоветуйтесь с врачом.
            </p>
          </>
        ) : (
          !busy && (
            <div className="pl-empty">
              <div className="pl-empty-ico" aria-hidden>
                📅
              </div>
              <h3>Здесь появится ваше меню на неделю</h3>
              <p className="muted">Выберите цель и нажмите «Сгенерировать меню». Любое блюдо потом можно заменить кнопкой 🔄 — бесплатно.</p>
            </div>
          )
        )}
      </div>

      {saved.length > 0 && (
        <section className="saved">
          <div className="row-head">
            <h2>Сохранённые меню</h2>
            <span className="muted small">блюда из них реже попадают в новые меню</span>
          </div>
          <div className="saved-list">
            {saved.map((s) => (
              <div key={s.createdAt} className={'saved-item' + (plan?.createdAt === s.createdAt ? ' on' : '')}>
                <div className="saved-thumbs" aria-hidden>
                  {s.days[0].meals.slice(0, 3).map((m) => {
                    const it = byId.get(m.id)
                    return it?.im ? <img key={m.id} src={imgUrl(m.id)} alt="" loading="lazy" /> : <span key={m.id}>🍽️</span>
                  })}
                </div>
                <div className="saved-info">
                  <b>
                    {new Date(s.savedAt).toLocaleDateString('ru', {
                      day: 'numeric',
                      month: 'long',
                    })}
                  </b>
                  <span>
                    {goalName(s.settings.goal)} · {s.settings.kcal.toLocaleString('ru')} ккал
                  </span>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setPlan(s)
                    setShowSettings(false)
                    setTimeout(
                      () =>
                        resultRef.current?.scrollIntoView({
                          behavior: 'smooth',
                        }),
                      50,
                    )
                  }}
                >
                  Открыть
                </button>
                <button className="icon-btn" onClick={() => setSaved((x) => x.filter((y) => y.createdAt !== s.createdAt))} aria-label="Удалить меню">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default function Planner({ items }: { items: IndexItem[] }) {
  const { access, loaded } = useAuth()
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  if (!loaded)
    return (
      <div className="planner" aria-busy="true">
        <div className="skeleton sk-h1" style={{ width: '40%', marginTop: 20 }} />
        <div className="skeleton sk-box" style={{ height: 320 }} />
      </div>
    )
  return canPlan(access) ? <Assistant items={items} byId={byId} /> : <Promo items={items} byId={byId} />
}
