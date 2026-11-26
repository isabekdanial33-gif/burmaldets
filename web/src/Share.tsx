// «Поделиться рецептом»: карточка без ингредиентов и шагов — только название, фото, время, ккал и ссылка.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fmtMinutes, imgUrl, type IndexItem } from './data'
import { toast } from './ui'

// В продакшене — статическая страница /r/<id> (collector/seo_pages.py): у неё своё фото и описание
// в превью WhatsApp/Telegram и она индексируется поисковиками. В разработке — обычная ссылка приложения.
export const recipeLink = (id: string) =>
  import.meta.env.DEV ? `${location.origin}${location.pathname}#/r/${id}` : `${location.origin}${import.meta.env.BASE_URL}r/${id}`

/** Текст для мессенджеров. Специально без ингредиентов и шагов — они доступны в приложении. */
export function shareText(i: IndexItem) {
  const facts = [i.m[0] && (i.tp ? `${i.m[0]} ${i.tp} °C` : i.m[0]), i.min && `⏱ ${fmtMinutes(i.min)}`, i.kc && `${i.kc} ккал на порцию`].filter(Boolean).join(' · ')
  return `🍽 ${i.t}${facts ? `\n${facts}` : ''}\nРецепт для ГрандШефа — в MyGrandChef:`
}

async function photoFile(i: IndexItem): Promise<File | null> {
  if (!i.im) return null
  try {
    const r = await fetch(imgUrl(i.id))
    if (!r.ok) return null
    const b = await r.blob()
    return new File([b], `${i.id}.${b.type.includes('png') ? 'png' : b.type.includes('jpeg') ? 'jpg' : 'webp'}`, { type: b.type || 'image/webp' })
  } catch {
    return null
  }
}

export function ShareSheet({ item, onClose }: { item: IndexItem; onClose: () => void }) {
  const url = recipeLink(item.id)
  const text = shareText(item)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    box.current?.querySelector<HTMLElement>('a,button')?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const native = async () => {
    try {
      const f = await photoFile(item)
      const data: ShareData = { title: item.t, text, url }
      if (f && navigator.canShare?.({ files: [f] })) data.files = [f]
      await navigator.share(data)
      onClose()
    } catch {
      /* отменено */
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      toast('Ссылка скопирована')
      onClose()
    } catch {
      toast('Не получилось скопировать — выделите ссылку вручную')
    }
  }

  return createPortal(
    <div className="share-back" onClick={onClose}>
      <div className="share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={box} onClick={(e) => e.stopPropagation()}>
        <div className="share-head">
          <b id="share-title">Поделиться рецептом</b>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="share-card">
          {item.im ? <img src={imgUrl(item.id)} alt="" /> : <div className="share-ph">🍽️</div>}
          <div>
            <b>{item.t}</b>
            <span>
              {[item.m[0], item.tp && `${item.tp} °C`, item.min && fmtMinutes(item.min), item.kc && `${item.kc} ккал`].filter(Boolean).join(' · ')}
            </span>
            <small>{url.replace(/^https?:\/\//, '')}</small>
          </div>
        </div>
        <div className="share-btns">
          <a className="share-btn tg" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            <span aria-hidden>✈️</span> Telegram
          </a>
          <a className="share-btn wa" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            <span aria-hidden>💬</span> WhatsApp
          </a>
          <button className="share-btn" onClick={copy}>
            <span aria-hidden>🔗</span> Скопировать ссылку
          </button>
          {'share' in navigator && (
            <button className="share-btn" onClick={native}>
              <span aria-hidden>↗</span> Другое…
            </button>
          )}
        </div>
        <p className="share-note">Друзья увидят название, фото, время и калорийность. Сам рецепт откроется в MyGrandChef.</p>
      </div>
    </div>,
    document.body,
  )
}
