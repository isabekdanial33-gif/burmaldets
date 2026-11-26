import { useMemo, useState } from 'react'
import { AISLES, aisleOf, OTHER_AISLE } from '../aisles'
import { clearRecipeCache, type IndexItem, type Meta, plural } from '../data'
import { fmtUntil, mySubs } from '../plans'
import { actions, useStore } from '../store'
import { accounts, configured, isDevSim, signOut, useAuth } from '../supa'
import { Avatar, CrownIcon, Empty, Grid, InstallCard, loginHref, toast } from '../ui'

function Account() {
  const { email, access, loaded } = useAuth()
  const subs = mySubs(access)
  const top = subs[0]
  if (!email)
    return (
      <section className="account guest">
        <div className="acc-main">
          <div className="acc-ico" aria-hidden>
            👤
          </div>
          <div>
            <b>Войдите в аккаунт</b>
            <span>{configured ? 'Отзывы, бесплатные рецепты и подписка — на всех ваших устройствах.' : 'Вход заработает после запуска сервера.'}</span>
          </div>
        </div>
        <div className="acc-actions">
          <a className="btn primary" href={loginHref('/my')}>
            Войти
          </a>
          <a className="btn ghost" href="#/plans">
            Тарифы
          </a>
        </div>
      </section>
    )
  return (
    <section className={'account' + (top?.plan.code === 'grandchef' ? ' gold' : '')}>
      <div className="acc-main">
        <Avatar email={email} size={52} />
        <div className="acc-info">
          <b className="acc-email">{email}</b>
          {!loaded ? (
            <span>Загружаем тариф…</span>
          ) : top ? (
            <span className="acc-plan">
              {top.plan.code === 'grandchef' && <CrownIcon size={14} />}
              <b>{subs.map((s) => s.plan.name).join(' + ')}</b> · {fmtUntil(top.until)}
            </span>
          ) : (
            <span>Бесплатный доступ · {configured || isDevSim ? 'открыты бесплатные рецепты' : 'локальный режим'}</span>
          )}
        </div>
      </div>
      <div className="acc-actions">
        {access.admin && (
          <a className="btn ghost" href="#/admin">
            ⚙ Админка
          </a>
        )}
        {top?.plan.code === 'grandchef' && (
          <a className="btn ghost" href="#/planner">
            👑 Шеф-ассистент
          </a>
        )}
        <a className="btn" href="#/plans">
          {top ? (top.until ? 'Продлить' : 'Тарифы') : 'Выбрать тариф'}
        </a>
        <button
          className="btn ghost"
          onClick={async () => {
            await signOut()
            clearRecipeCache()
            toast('Вы вышли из аккаунта')
          }}
        >
          Выйти
        </button>
      </div>
    </section>
  )
}

const VKEY = 'mgc:shop-view'
export function Shopping() {
  const list = useStore((s) => s.shop)
  const [view, setView] = useState<'recipe' | 'aisle'>(() => {
    try {
      return localStorage.getItem(VKEY) === 'aisle' ? 'aisle' : 'recipe'
    } catch {
      return 'recipe'
    }
  })
  const switchView = (v: 'recipe' | 'aisle') => {
    setView(v)
    try {
      localStorage.setItem(VKEY, v)
    } catch {
      /* не страшно */
    }
  }
  const groups = useMemo(() => {
    const m = new Map<string, typeof list>()
    list.forEach((s) => {
      const k = view === 'aisle' ? aisleOf(s.text) : s.recipe || 'Без рецепта'
      m.set(k, [...(m.get(k) || []), s])
    })
    const out = [...m.entries()]
    // отделы — в порядке обхода магазина, купленное — в конец группы
    if (view === 'aisle') {
      const order = [...AISLES.map((a) => a.name), OTHER_AISLE]
      out.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      out.forEach((g) => g[1].sort((x, y) => Number(x.done) - Number(y.done) || x.text.localeCompare(y.text, 'ru')))
    }
    return out
  }, [list, view])
  const [text, setText] = useState('')
  const copy = async () => {
    const t = groups
      .filter(([, l]) => l.some((x) => !x.done))
      .map(([g, l]) => `${g}:\n` + l.filter((x) => !x.done).map((x) => `• ${x.text}`).join('\n')).join('\n\n')
    try {
      if (navigator.share) await navigator.share({ title: 'Список покупок', text: t })
      else {
        await navigator.clipboard.writeText(t)
        toast('Список скопирован')
      }
    } catch {
      /* отменено */
    }
  }
  return (
    <div className="page narrow">
      <h1>🛒 Список покупок</h1>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) actions.addShop([text.trim()])
          setText('')
        }}
      >
        <span className="search-ico">＋</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Добавить свой пункт…" aria-label="Пункт" />
        <button className="btn primary">Добавить</button>
      </form>
      {list.length === 0 ? (
        <Empty title="Список пуст" text="Откройте рецепт и нажмите «Добавить в список покупок»." action={<a className="btn" href="#/catalog">Выбрать рецепт</a>} />
      ) : (
        <>
          <div className="tabs shop-view" role="tablist" aria-label="Группировка списка">
            <button role="tab" aria-selected={view === 'recipe'} className={view === 'recipe' ? 'on' : ''} onClick={() => switchView('recipe')}>
              По рецептам
            </button>
            <button role="tab" aria-selected={view === 'aisle'} className={view === 'aisle' ? 'on' : ''} onClick={() => switchView('aisle')}>
              По отделам магазина
            </button>
          </div>
          <div className="list-tools">
            <button className="btn" onClick={copy}>
              ↗ Отправить / скопировать
            </button>
            <button className="btn ghost" onClick={() => actions.clearShop(true)}>
              Убрать купленное
            </button>
            <button className="btn ghost" onClick={() => actions.clearShop(false)}>
              Очистить всё
            </button>
          </div>
          {groups.map(([g, l]) => (
            <div key={g} className="shop-group">
              <div className="shop-g">
                {view === 'recipe' && l[0].recipeId ? <a href={`#/r/${l[0].recipeId}`}>{g}</a> : g}
                {view === 'aisle' && <small className="muted"> · {l.filter((x) => !x.done).length} из {l.length}</small>}
              </div>
              {l.map((s) => (
                <div key={s.id} className={'shop-item' + (s.done ? ' done' : '')}>
                  <label>
                    <input type="checkbox" checked={s.done} onChange={() => actions.toggleShop(s.id)} />
                    <span>
                      {s.text}
                      {view === 'aisle' && s.recipe && <small className="shop-from">{s.recipe}</small>}
                    </span>
                  </label>
                  <button className="icon-btn" onClick={() => actions.removeShop(s.id)} aria-label="Удалить">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export function My({ items }: { items: IndexItem[] }) {
  const fav = useStore((s) => s.fav)
  const cooked = useStore((s) => s.cooked)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const favItems = fav.map((id) => byId.get(id)).filter(Boolean) as IndexItem[]
  const cookedList = Object.entries(cooked).sort((a, b) => b[1].at.localeCompare(a[1].at))
  const cookedItems = cookedList.map(([id]) => byId.get(id)).filter(Boolean) as IndexItem[]
  const [tab, setTab] = useState<'fav' | 'cooked'>('fav')
  const cats = new Set(cookedItems.flatMap((i) => i.c))
  return (
    <div className="page">
      <h1>📔 Мой дневник</h1>
      {accounts && <Account />}
      {accounts && (
        <a className="add-cta wide" href="#/add">
          <b>＋ Добавить свой рецепт</b>
          <span>Только рецепты, которые вы сами готовили в ГрандШефе. После модерации — в каталоге с отметкой «От владельца».</span>
        </a>
      )}
      <InstallCard />
      <div className="my-stats">
        <div>
          <b>{cookedItems.length}</b>
          <span>{plural(cookedItems.length, 'блюдо приготовлено', 'блюда приготовлено', 'блюд приготовлено')}</span>
        </div>
        <div>
          <b>{favItems.length}</b>
          <span>в избранном</span>
        </div>
        <div>
          <b>{cats.size}</b>
          <span>{plural(cats.size, 'категория освоена', 'категории освоены', 'категорий освоено')}</span>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'fav' ? 'on' : ''} onClick={() => setTab('fav')}>
          ♥ Избранное
        </button>
        <button className={tab === 'cooked' ? 'on' : ''} onClick={() => setTab('cooked')}>
          ✓ Приготовлено
        </button>
      </div>
      {tab === 'fav' ? (
        favItems.length ? (
          <Grid items={favItems} />
        ) : (
          <Empty title="Пока ничего" text="Нажмите ♡ на карточке рецепта, чтобы сохранить его здесь." />
        )
      ) : cookedItems.length ? (
        <Grid
          items={cookedItems}
          extra={(i) => {
            const c = cooked[i.id]
            return <span className="muted small">{c.rating ? '★'.repeat(c.rating) : new Date(c.at).toLocaleDateString('ru')}</span>
          }}
        />
      ) : (
        <Empty title="Ещё ничего не приготовлено" text="В конце рецепта нажмите «Я приготовил» — здесь соберётся ваша история с оценками и заметками." />
      )}
      <p className="muted small">Избранное, дневник и список покупок хранятся только на этом устройстве.</p>
    </div>
  )
}

const PROBE: [string, string, string][] = [
  ['Говядина, стейк — с кровью (rare)', '50–52 °C', 'после отдыха поднимется на 2–3 °C'],
  ['Говядина — medium rare', '55–57 °C', ''],
  ['Говядина — medium', '60–63 °C', ''],
  ['Говядина — well done', '70 °C и выше', ''],
  ['Свинина (целые куски)', '63 °C', 'плюс 3 минуты отдыха'],
  ['Фарш (говядина, свинина)', '71 °C', ''],
  ['Курица, индейка, утка (любая часть)', '74 °C', 'в самой толстой части, не касаясь кости'],
  ['Рыба', '63 °C', 'или пока мякоть не станет непрозрачной'],
  ['Разогрев готовых блюд', '74 °C', ''],
]

export function Tools() {
  const [t, setT] = useState(200)
  const [min, setMin] = useState(40)
  const at = Math.max(80, Math.round((t - 20) / 5) * 5)
  const am = Math.max(1, Math.round(min * 0.8))
  return (
    <div className="page narrow">
      <h1>🧰 Инструменты</h1>
      <a className="add-cta wide" href="#/modes">
        <b>Справка по режимам ГрандШефа →</b>
        <span>Для чего каждый режим, типичные температура и время по рецептам каталога, лучшие рецепты.</span>
      </a>
      <section className="tool">
        <h2>Духовка → ГрандШеф</h2>
        <p className="muted">
          Нашли рецепт для духовки? Общепринятое правило для аэрогрилей: температура примерно на 20 °C ниже, время — примерно на 20% меньше. Это
          ориентир, а не точный рецепт: проверяйте готовность термощупом или на глаз.
        </p>
        <div className="conv">
          <label>
            Духовка, °C
            <input type="number" value={t} min={80} max={300} step={5} onChange={(e) => setT(Number(e.target.value))} />
          </label>
          <label>
            Время, мин
            <input type="number" value={min} min={1} max={600} onChange={(e) => setMin(Number(e.target.value))} />
          </label>
          <div className="conv-arrow">→</div>
          <div className="conv-out">
            <b>
              {at} °C · ~{am} мин
            </b>
            <span>режим АЭРОГРИЛЬ или ВЫПЕЧКА, проверить на {Math.max(1, Math.round(am * 0.75))}-й минуте</span>
          </div>
        </div>
      </section>
      <section className="tool">
        <h2>Шпаргалка термощупа</h2>
        <p className="muted">Минимальная безопасная температура внутри продукта — по рекомендациям USDA (Минсельхоз США) и общепринятым степеням прожарки.</p>
        <table className="probe">
          <tbody>
            {PROBE.map(([a, b, c]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>
                  <b>{b}</b>
                </td>
                <td className="muted small">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

export function About({ meta, items }: { meta: Meta; items: IndexItem[] }) {
  const hi = items.filter((i) => i.tr >= 80).length
  const mid = items.filter((i) => i.tr >= 60 && i.tr < 80).length
  return (
    <div className="page narrow about">
      <h1>Как мы проверяем рецепты</h1>
      <p>
        «MyGrandChef» — неофициальный каталог рецептов для мультишефа-аэрогриля ГрандШеф. Мы <b>не придумываем и не генерируем рецепты</b>: каждый
        рецепт взят из открытого источника, где он был опубликован специально для ГрандШефа, и у каждого есть ссылка на оригинал.
      </p>
      <h2>Индекс проверенности (0–100)</h2>
      <ul className="trust-parts static">
        <li>
          <span>Опубликован официальным каналом ГрандШеф</span>
          <b>+50</b>
        </li>
        <li>
          <span>…или в официальном приложении ГрандШеф</span>
          <b>+45</b>
        </li>
        <li>
          <span>…или владельцем прибора / сообществом</span>
          <b>+35 / +20</b>
        </li>
        <li>
          <span>Указан режим прибора</span>
          <b>+10</b>
        </li>
        <li>
          <span>Указана температура</span>
          <b>+8</b>
        </li>
        <li>
          <span>Указано время</span>
          <b>+7</b>
        </li>
        <li>
          <span>Есть фото или видео результата</span>
          <b>+5</b>
        </li>
        <li>
          <span>Популярность (просмотры: 2 тыс / 8 тыс / 20 тыс+)</span>
          <b>+4 / +7 / +10</b>
        </li>
        <li>
          <span>Тот же рецепт найден в нескольких источниках</span>
          <b>+10</b>
        </li>
      </ul>
      <p>
        Сейчас: <b>{hi}</b> рецептов с отметкой «Проверен» (80+), <b>{mid}</b> — «Надёжный» (60–79). Рецепт попадает в каталог, только если в посте
        есть и список ингредиентов, и способ приготовления.
      </p>
      <h2>Источники</h2>
      <table className="probe">
        <tbody>
          {meta.sources.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td className="muted">
                {s.platform} · {s.kind === 'official' ? 'официальный' : s.kind === 'app' ? 'официальное приложение' : s.kind === 'owner' ? 'владельцы' : 'сообщество'}
              </td>
              <td>
                <b>{s.count}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Данные обновлены {new Date(meta.built).toLocaleDateString('ru')}. ГрандШеф и RETASTE — товарные знаки их владельцев; сайт с ними не связан. Права
        на тексты и фото рецептов принадлежат авторам — открывайте оригиналы по ссылкам.
      </p>
    </div>
  )
}
