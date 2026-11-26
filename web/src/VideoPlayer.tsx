import { useEffect, useState } from 'react'

export type Video = { type: 'yc' | 'rutube' | 'youtube' | 'tg'; src: string; from: string }

// Разрешаем только известные плееры — ссылка из данных не может подсунуть чужой iframe.
const ALLOWED = /^https:\/\/(runtime\.video\.cloud\.yandex\.net\/player\/|rutube\.ru\/play\/embed\/|www\.youtube-nocookie\.com\/embed\/|t\.me\/\w+\/\d+\?embed=1)/

const LABEL: Record<Video['type'], string> = { yc: 'ГрандШеф', rutube: 'Rutube', youtube: 'YouTube', tg: 'Telegram' }

/** Видео рецепта прямо на странице: плеер ГрандШеф / Rutube / YouTube / пост Telegram. */
export default function VideoPlayer({ videos, title }: { videos: Video[]; title: string }) {
  const list = videos.filter((v) => ALLOWED.test(v.src))
  const [i, setI] = useState(0)
  const [on, setOn] = useState(false)
  const [tgH, setTgH] = useState(520)
  const v = list[Math.min(i, list.length - 1)]

  // виджет Telegram сам сообщает свою высоту
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.origin !== 'https://t.me') return
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        if (d?.event === 'resize' && d.height > 100) setTgH(Math.min(1600, Math.ceil(d.height)))
      } catch {
        /* чужое сообщение */
      }
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [])

  if (!v) return null
  const tg = v.type === 'tg'
  const src = v.type === 'yc' && on ? v.src.replace('autoplay=0', 'autoplay=1') : v.type === 'rutube' || v.type === 'youtube' ? v.src + (on ? (v.src.includes('?') ? '&' : '?') + 'autoplay=1' : '') : v.src

  return (
    <div className="vplayer" id="video">
      {list.length > 1 && (
        <div className="vtabs" role="tablist" aria-label="Источник видео">
          {list.map((x, k) => (
            <button key={x.src} role="tab" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => (setI(k), setOn(false), setTgH(520))}>
              ▶ {LABEL[x.type]}
            </button>
          ))}
        </div>
      )}
      <div className={'vframe ' + v.type} style={tg ? { height: tgH } : undefined}>
        {!on && !tg ? (
          <button className="vstart" onClick={() => setOn(true)} aria-label={'Смотреть видео: ' + title}>
            <span className="vplay">▶</span>
            <span>Смотреть видео · {LABEL[v.type]}</span>
          </button>
        ) : (
          <iframe
            key={v.src + on}
            src={src}
            title={'Видео: ' + title}
            loading="lazy"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            {...(tg ? { scrolling: 'no' } : {})}
          />
        )}
      </div>
    </div>
  )
}
