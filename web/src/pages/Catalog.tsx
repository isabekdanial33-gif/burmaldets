import type MiniSearch from 'minisearch'
import { useEffect, useMemo, useState } from 'react'
import { collectionBySlug, collectionItems, COLLECTIONS } from '../collections'
import { accounts } from '../supa'
import { CATEGORIES, getSearch, type IndexItem, MODES, plural, searchIfReady, stem, tokenize } from '../data'
import { Empty, go, Grid, SkeletonGrid } from '../ui'

const TAGS = ['Быстро', 'Термощуп', 'ПП', 'Без масла', 'Праздничное', 'Детям', 'Постное', 'Из замороженного']
const TIMES = [15, 20, 30, 45, 60]
const SORTS: [string, string][] = [
  ['rel', 'По релевантности'],
  ['col', 'Как в подборке'],
  ['pop', 'Популярные'],
  ['trust', 'Самые проверенные'],
  ['new', 'Новые'],
  ['fast', 'Быстрые'],
]

export default function Catalog({ items, params }: { items: IndexItem[]; params: URLSearchParams }) {
  const q = params.get('q') || ''
  const cat = params.get('cat') || ''
  const mode = params.get('mode') || ''
  const tag = params.get('tag') || ''
  const max = Number(params.get('max') || 0)
  const minTrust = Number(params.get('trust') || 0)
  const video = params.get('video') === '1'
  const own = params.get('own') === '1'
  const col = collectionBySlug(params.get('col') || '')
  const hasOwn = useMemo(() => items.some((i) => i.sk.includes('owner')), [items])
  const sort = params.get('sort') || (q ? 'rel' : params.get('col') ? 'col' : 'pop')
  const [text, setText] = useState(q)
  const [limit, setLimit] = useState(48)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // на телефоне автофокус поднимает клавиатуру при каждом входе в каталог — только на широком экране
  const [wide] = useState(() => window.matchMedia('(min-width: 941px)').matches)
  const [search, setSearch] = useState<MiniSearch<IndexItem> | null>(searchIfReady)
  useEffect(() => {
    if (!search) getSearch().then(setSearch)
  }, [search])
  useEffect(() => setText(q), [q])
  useEffect(() => setLimit(48), [q, cat, mode, tag, max, minTrust, video, own, col, sort])

  const setParam = (k: string, v: string | number | null) => {
    const p = new URLSearchParams(params)
    if (v === null || v === '' || v === 0) p.delete(k)
    else p.set(k, String(v))
    go('/catalog?' + p.toString())
  }

  const found = useMemo(() => {
    let list: IndexItem[]
    const byId = new Map(items.map((i) => [i.id, i]))
    // «без масла», «без сахара» — исключить продукт, а не искать его
    const without = [...q.toLowerCase().matchAll(/без\s+([а-яё]{3,})/g)].map((m) => stem(m[1]))
    const text = q.replace(/без\s+[а-яёА-ЯЁ]{3,}/g, ' ').trim()
    if (text && !search) return null
    if (text && search) {
      let hits = search.search(text)
      if (!hits.length) hits = search.search(text, { combineWith: 'OR' })
      list = hits.map((h) => byId.get(h.id as string)!).filter(Boolean)
    } else list = col ? [...collectionItems(items, col)] : [...items]
    if (col && q.trim()) list = list.filter(col.test)
    if (without.length) list = list.filter((i) => !i.ing.some((x) => tokenize(x).some((w) => without.some((n) => stem(w).startsWith(n)))))
    list = list.filter(
      (i) =>
        (!cat || i.c.includes(cat)) &&
        (!mode || i.m.includes(mode)) &&
        (!tag || i.g.includes(tag)) &&
        (!max || (i.min && i.min <= max)) &&
        (!minTrust || i.tr >= minTrust) &&
        (!video || i.v) &&
        (!own || i.sk.includes('owner')),
    )
    if (sort === 'pop') list.sort((a, b) => b.vw - a.vw)
    else if (sort === 'trust') list.sort((a, b) => b.tr - a.tr || b.vw - a.vw)
    else if (sort === 'new') list.sort((a, b) => b.d.localeCompare(a.d))
    else if (sort === 'fast') list.sort((a, b) => (a.min || 999) - (b.min || 999))
    return list
  }, [items, search, q, cat, mode, tag, max, minTrust, video, own, col, sort])
  const searching = found === null
  const results = found ?? []

  const active = [col ? col.emoji + ' ' + col.title : '', cat, mode, tag, max ? `до ${max} мин` : '', minTrust ? `от ${minTrust} баллов` : '', video ? 'с видео' : '', own ? 'от владельцев' : ''].filter(Boolean)

  return (
    <div className="catalog">
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          setParam('q', text)
        }}
      >
        <span className="search-ico">⌕</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Блюдо, ингредиент или режим…" aria-label="Поиск" autoFocus={!cat && !mode && wide} />
        {text && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setText('')
              setParam('q', '')
            }}
          >
            ✕
          </button>
        )}
        <button className="btn primary">Найти</button>
      </form>

      <div className="catalog-layout">
        <aside className={'filters' + (filtersOpen ? ' open' : '')}>
          <div className="filters-head">
            <b>Фильтры</b>
            <button className="icon-btn mobile-only" onClick={() => setFiltersOpen(false)}>
              ✕
            </button>
          </div>
          <div className="f-group">
            <div className="f-title">Подборки</div>
            <div className="chips small">
              {COLLECTIONS.map((c) => (
                <button key={c.slug} className={'chip' + (col?.slug === c.slug ? ' on' : '')} onClick={() => setParam('col', col?.slug === c.slug ? '' : c.slug)}>
                  {c.emoji} {c.title}
                </button>
              ))}
            </div>
          </div>
          <div className="f-group">
            <div className="f-title">Категория</div>
            {CATEGORIES.map((c) => (
              <button key={c.name} className={'f-opt' + (cat === c.name ? ' on' : '')} onClick={() => setParam('cat', cat === c.name ? '' : c.name)}>
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
          <div className="f-group">
            <div className="f-title">Режим ГрандШефа</div>
            <div className="chips small">
              {MODES.map((m) => (
                <button key={m} className={'chip' + (mode === m ? ' on' : '')} onClick={() => setParam('mode', mode === m ? '' : m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="f-group">
            <div className="f-title">Время приготовления</div>
            <div className="chips small">
              {TIMES.map((t) => (
                <button key={t} className={'chip' + (max === t ? ' on' : '')} onClick={() => setParam('max', max === t ? 0 : t)}>
                  до {t} мин
                </button>
              ))}
            </div>
          </div>
          <div className="f-group">
            <div className="f-title">Особенности</div>
            <div className="chips small">
              {TAGS.map((t) => (
                <button key={t} className={'chip' + (tag === t ? ' on' : '')} onClick={() => setParam('tag', tag === t ? '' : t)}>
                  {t}
                </button>
              ))}
              <button className={'chip' + (video ? ' on' : '')} onClick={() => setParam('video', video ? '' : '1')}>
                ▶ С видео
              </button>
              {hasOwn && (
                <button className={'chip' + (own ? ' on' : '')} onClick={() => setParam('own', own ? '' : '1')}>
                  👨‍🍳 От владельцев
                </button>
              )}
            </div>
          </div>
          <div className="f-group">
            <div className="f-title">Проверенность</div>
            <div className="chips small">
              {[
                [0, 'Любая'],
                [60, 'Надёжные 60+'],
                [80, 'Проверенные 80+'],
              ].map(([v, l]) => (
                <button key={v} className={'chip' + (minTrust === v ? ' on' : '')} onClick={() => setParam('trust', v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {accounts && (
          <a className="add-cta" href="#/add">
            <b>＋ Добавить свой рецепт</b>
            <span>Готовите в ГрандШефе что-то своё? Поделитесь — после проверки рецепт появится здесь.</span>
          </a>
          )}
          <div className="f-apply mobile-only">
            <button className="btn primary" onClick={() => setFiltersOpen(false)}>
              {searching ? 'Показать' : `Показать ${results.length.toLocaleString('ru')} ${plural(results.length, 'рецепт', 'рецепта', 'рецептов')}`}
            </button>
          </div>
        </aside>
        {filtersOpen && <div className="f-back mobile-only" onClick={() => setFiltersOpen(false)} aria-hidden />}

        <div className="results">
          <div className="results-head">
            <div>
              <b>
                {searching ? 'Ищем…' : `${results.length.toLocaleString('ru')} ${plural(results.length, 'рецепт', 'рецепта', 'рецептов')}`}
              </b>
              {q && <span className="muted"> по запросу «{q}»</span>}
              {active.length > 0 && (
                <span className="active-filters">
                  {active.map((a) => (
                    <span key={a} className="chip on tiny">
                      {a}
                    </span>
                  ))}
                  <button className="link" onClick={() => go(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog')}>
                    сбросить
                  </button>
                </span>
              )}
            </div>
            <div className="results-tools">
              <button className="btn ghost mobile-only" onClick={() => setFiltersOpen(true)}>
                ⚙ Фильтры{active.length ? ` (${active.length})` : ''}
              </button>
              <select value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Сортировка">
                {SORTS.filter(([k]) => (k !== 'rel' || q) && (k !== 'col' || (col && !q))).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {searching ? (
            <SkeletonGrid n={8} />
          ) : results.length ? (
            <>
              <Grid items={results.slice(0, limit)} />
              {limit < results.length && (
                <div className="more">
                  <button className="btn" onClick={() => setLimit((l) => l + 48)}>
                    Показать ещё ({results.length - limit})
                  </button>
                </div>
              )}
            </>
          ) : (
            <Empty title="Ничего не нашлось" text="Попробуйте другое слово или уберите часть фильтров." action={<a className="btn" href="#/fridge">Поискать по продуктам из холодильника</a>} />
          )}
        </div>
      </div>
    </div>
  )
}
