import { useMemo } from 'react'
import CollectionTiles from '../CollectionTiles'
import { collectionItems, COLLECTIONS } from '../collections'
import type { IndexItem } from '../data'
import { RecipeCard } from '../ui'

export default function Collections({ items }: { items: IndexItem[] }) {
  const rows = useMemo(() => COLLECTIONS.map((c) => ({ c, list: collectionItems(items, c) })).filter((r) => r.list.length), [items])
  return (
    <div className="page collections">
      <h1>Подборки</h1>
      <p className="muted">Собраны автоматически из каталога: по тегам, КБЖУ на порцию, режиму и числу ингредиентов.</p>
      <CollectionTiles items={items} />
      {rows.map(({ c, list }) => (
        <section key={c.slug} className="row">
          <div className="row-head">
            <h2>
              {c.emoji} {c.title}
            </h2>
            <a className="link" href={`#/catalog?col=${c.slug}`}>
              Все {list.length} →
            </a>
          </div>
          <div className="row-scroll">
            {list.slice(0, 12).map((r) => (
              <RecipeCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
