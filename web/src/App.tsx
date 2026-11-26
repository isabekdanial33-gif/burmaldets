import { lazy, Suspense, useEffect, useState } from 'react'
import { getSearch, loadIndex } from './data'
import Home from './pages/Home'
import { useStore } from './store'
import { accounts, freeMode, useAuth, useRefreshOnFocus } from './supa'
import { TimersDock } from './timers'
import { Avatar, CrownIcon, SkeletonGrid, Toast, useHash } from './ui'

type Loaded = Awaited<ReturnType<typeof loadIndex>>

/**
 * После обновления сайта старые чанки исчезают — если вкладка была открыта давно, импорт падает.
 * Тогда один раз перезагружаем страницу (флаг в sessionStorage защищает от цикла).
 */
function retry<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().then(
      (m) => {
        sessionStorage.removeItem('mgc:chunk-reload')
        return m
      },
      (e) => {
        if (!sessionStorage.getItem('mgc:chunk-reload')) {
          sessionStorage.setItem('mgc:chunk-reload', '1')
          location.reload()
          return new Promise<T>(() => {})
        }
        throw e
      },
    )
}

// Страницы, кроме главной, грузятся отдельными чанками — главная открывается быстрее.
const loadCatalog = retry(() => import('./pages/Catalog'))
const loadRecipePage = retry(() => import('./pages/RecipePage'))
const loadOther = retry(() => import('./pages/Other'))
const Catalog = lazy(loadCatalog)
const RecipePage = lazy(loadRecipePage)
const Fridge = lazy(retry(() => import('./pages/Fridge')))
const Planner = lazy(retry(() => import('./pages/Planner')))
const Plans = lazy(retry(() => import('./pages/Plans')))
const Admin = lazy(retry(() => import('./pages/Admin')))
const Auth = lazy(retry(() => import('./pages/Auth')))
const AddRecipe = lazy(retry(() => import('./pages/AddRecipe')))
const Collections = lazy(retry(() => import('./pages/Collections')))
const Modes = lazy(retry(() => import('./pages/Modes')))
const Shopping = lazy(() => loadOther().then((m) => ({ default: m.Shopping })))
const My = lazy(() => loadOther().then((m) => ({ default: m.My })))
const Tools = lazy(() => loadOther().then((m) => ({ default: m.Tools })))
const About = lazy(() => loadOther().then((m) => ({ default: m.About })))
const ShefPage = lazy(retry(() => import('./shef/ShefPage')))

/** Когда браузер свободен — заранее подгружаем самые частые страницы, чтобы переход был мгновенным. */
function prefetchPages() {
  const run = () => {
    loadCatalog()
    loadRecipePage()
    getSearch()
  }
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2500)
}

function PageFallback() {
  return (
    <div className="boot" aria-busy="true" aria-label="Загружаем страницу">
      <div className="skeleton sk-h1" style={{ width: '45%', marginTop: 24 }} />
      <div className="skeleton sk-line" style={{ width: '30%', marginBottom: 26 }} />
      <SkeletonGrid n={4} />
    </div>
  )
}

const NAV: [string, string, string][] = [
  ['#/', 'Главная', '⌂'],
  ['#/catalog', 'Каталог', '☰'],
  ['#/fridge', 'Холодильник', '🧊'],
  ['#/list', 'Покупки', '🛒'],
  ['#/my', 'Дневник', '♥'],
]

const TITLES: Record<string, string> = {
  '/catalog': 'Каталог',
  '/shef': 'Бурмалдец — голосовой помощник',
  '/fridge': 'Холодильник',
  '/list': 'Список покупок',
  '/my': 'Мой дневник',
  '/tools': 'Инструменты',
  '/about': 'Как мы проверяем',
  '/plans': 'Тарифы',
  '/planner': 'Шеф-ассистент',
  '/admin': 'Админка',
  '/login': 'Вход',
  '/add': 'Добавить рецепт',
  '/collections': 'Подборки',
  '/modes': 'Режимы ГрандШефа',
}

export default function App() {
  const [data, setData] = useState<Loaded | null>(null)
  const [err, setErr] = useState(false)
  const { path, params } = useHash()
  const shopCount = useStore((s) => s.shop.filter((x) => !x.done).length)
  const { email } = useAuth()
  useRefreshOnFocus()

  useEffect(() => {
    loadIndex()
      .then((d) => {
        setData(d)
        prefetchPages()
      })
      .catch(() => setErr(true))
  }, [])
  useEffect(() => {
    if (!path.startsWith('/r/')) window.scrollTo(0, 0)
    const item = path.startsWith('/r/') ? data?.byId.get(path.slice(3)) : null
    const t = item ? item.t : TITLES[path]
    document.title = path === '/shef' || path === '/' || path === '' ? 'Бурмалдец' : t ? `${t} — Бурмалдец` : 'Рецепты — Бурмалдец'
  }, [path, data])

  let page: React.ReactNode = (
    <div className="boot" aria-busy="true" aria-label="Загружаем рецепты">
      <div className="skeleton sk-h1" style={{ width: '55%', marginTop: 24 }} />
      <div className="skeleton sk-line" style={{ width: '35%', marginBottom: 26 }} />
      <SkeletonGrid n={8} />
    </div>
  )
  if (err)
    page = (
      <div className="loading">
        Не удалось загрузить данные. Проверьте интернет и{' '}
        <button className="link" onClick={() => location.reload()}>
          обновите страницу
        </button>
        .
      </div>
    )
  else if (data) {
    if (path.startsWith('/r/')) page = <RecipePage item={data.byId.get(path.slice(3))} items={data.items} />
    else if (path === '/catalog') page = <Catalog items={data.items} params={params} />
    else if (path === '/fridge') page = <Fridge items={data.items} />
    else if (path === '/list') page = <Shopping />
    else if (path === '/my') page = <My items={data.items} />
    else if (path === '/tools') page = <Tools />
    else if (path === '/plans') page = <Plans items={data.items} />
    else if (path === '/planner') page = <Planner items={data.items} />
    else if (path === '/admin' && accounts) page = <Admin />
    else if (path === '/add' && accounts) page = <AddRecipe />
    else if (path === '/collections') page = <Collections items={data.items} />
    else if (path === '/modes') page = <Modes items={data.items} />
    else if (path === '/login' && accounts) page = <Auth next={params.get('next') ? '#' + params.get('next') : ''} />
    else if (path === '/about') page = <About meta={data.meta} items={data.items} />
    else page = <Home items={data.items} meta={data.meta} />
  }
  // Бурмалдец: главный экран — ассистент; каталог рецептов открывается из режима повара
  if (path === '/shef' || path === '/' || path === '')
    return (
      <Suspense fallback={<div className="shef-boot" />}>
        <ShefPage />
      </Suspense>
    )
  const cur = '#' + path
  const isOn = (h: string) => cur === h || (h !== '#/' && cur.startsWith(h + '/')) || (h !== '#/' && cur === h)

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        К содержимому
      </a>
      <header className="top">
        <a className="logo" href="#/" aria-label="MyGrandChef — на главную">
          <span className="logo-mark" aria-hidden>
            M
          </span>
          <span>
            MyGrandChef
            <small>рецепты для ГрандШефа</small>
          </span>
        </a>
        <nav className="top-nav" aria-label="Основное меню">
          {NAV.map(([h, l]) => (
            <a key={h} href={h} className={isOn(h) ? 'on' : ''} aria-current={isOn(h) ? 'page' : undefined}>
              {l}
              {h === '#/list' && shopCount > 0 && <i className="badge">{shopCount}</i>}
            </a>
          ))}
          <span className="nav-sep" aria-hidden />
          <a href="#/planner" className={'nav-gc' + (isOn('#/planner') ? ' on' : '')} aria-current={isOn('#/planner') ? 'page' : undefined}>
            <CrownIcon size={15} /> Шеф-ассистент
          </a>
          <a href="#/plans" className={isOn('#/plans') ? 'on' : ''} aria-current={isOn('#/plans') ? 'page' : undefined}>
            Тарифы
          </a>
        </nav>
        <div className="top-right">
          <a href="#/planner" className="gc-mini" aria-label="Шеф-ассистент Grand Chef">
            <CrownIcon size={17} />
          </a>
          {!accounts ? null : email ? (
            <a href="#/my" className="me" aria-label={`Аккаунт ${email}`} title={email}>
              <Avatar email={email} size={34} />
            </a>
          ) : (
            <a href={'#/login?next=' + encodeURIComponent(path === '/login' ? '/' : path || '/')} className="btn primary login-btn">
              Войти
            </a>
          )}
        </div>
      </header>
      {freeMode && (
        <div className="free-ribbon" role="note">
          🎉 Сейчас всё бесплатно: все рецепты и шеф-ассистент открыты без подписки
        </div>
      )}
      <main id="main" tabIndex={-1} key={path.startsWith('/r/') ? '/r' : path}>
        <Suspense fallback={<PageFallback />}>{page}</Suspense>
      </main>
      <footer className="foot">
        <div className="foot-links">
          <a href="#/plans">Тарифы</a>
          <a href="#/planner">Шеф-ассистент</a>
          <a href="#/collections">Подборки</a>
          <a href="#/modes">Режимы ГрандШефа</a>
          {accounts && <a href="#/add">Добавить свой рецепт</a>}
          <a href="#/tools">Инструменты</a>
          <a href="#/about">Как мы проверяем</a>
        </div>
        <div>MyGrandChef — неофициальный каталог рецептов для ГрандШеф. Все рецепты — из открытых источников, со ссылкой на оригинал.</div>
      </footer>
      <nav className="bottom-nav" aria-label="Нижнее меню">
        {NAV.map(([h, l, i]) => (
          <a key={h} href={h} className={isOn(h) ? 'on' : ''} aria-current={isOn(h) ? 'page' : undefined}>
            <span className="bn-ico" aria-hidden>
              {i}
              {h === '#/list' && shopCount > 0 && <i className="badge">{shopCount}</i>}
            </span>
            <span>{l}</span>
          </a>
        ))}
      </nav>
      <a className="shef-fab" href="#/shef" aria-label="Позвать Бурмалдеца — голосового помощника">
        <i />
        <i />
        <b>Бурмалдец</b>
      </a>
      <TimersDock />
      <Toast />
    </>
  )
}
