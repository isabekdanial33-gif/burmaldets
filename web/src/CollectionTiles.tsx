import { useMemo } from 'react'
import { collectionItems, COLLECTIONS } from './collections'
import { imgUrl, type IndexItem, plural } from './data'

/** Плитки подборок: коллаж из трёх фото, название и число рецептов. */
export default function CollectionTiles({ items }: { items: IndexItem[] }) {
  const tiles = useMemo(() => {
    // разные фото в разных плитках — популярные рецепты входят сразу в несколько подборок
    const used = new Set<string>()
    return COLLECTIONS.map((c) => {
      const list = collectionItems(items, c)
      const pics: IndexItem[] = []
      // сначала фото из приложения ГрандШеф — там всегда снято само блюдо (в постах бывают кадры с людьми и мемы)
      const ordered = [...list.filter((i) => i.sk.includes('app')), ...list.filter((i) => !i.sk.includes('app'))]
      for (const i of ordered) {
        if (pics.length >= 3) break
        if (i.im && !used.has(i.id)) {
          pics.push(i)
          used.add(i.id)
        }
      }
      return { c, n: list.length, pics }
    }).filter((t) => t.n > 0)
  }, [items])
  return (
    <div className="col-tiles">
      {tiles.map(({ c, n, pics }) => (
        <a key={c.slug} className="col-tile" href={`#/catalog?col=${c.slug}`}>
          <div className="col-pics" aria-hidden>
            {pics.map((p) => (
              <img key={p.id} src={imgUrl(p.id)} alt="" loading="lazy" decoding="async" />
            ))}
            <span className="col-emoji">{c.emoji}</span>
          </div>
          <div className="col-text">
            <b>{c.title}</b>
            <small>{c.sub}</small>
            <em>
              {n.toLocaleString('ru')} {plural(n, 'рецепт', 'рецепта', 'рецептов')}
            </em>
          </div>
        </a>
      ))}
    </div>
  )
}
