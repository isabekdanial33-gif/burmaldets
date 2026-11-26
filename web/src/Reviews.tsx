import { useCallback, useEffect, useRef, useState } from 'react'
import { configured, errText, sb, useAuth } from './supa'
import { toast } from './ui'

type Author = { id: string; name: string; avatar: string | null; badge: 'grandchef' | 'sub' | null }
type Review = {
  id: string
  root_id: string | null
  reply_to: string | null
  reply_to_name: string | null
  body: string | null
  deleted: boolean
  rating: number | null
  likes: number
  replies: number
  created_at: string
  mine: boolean
  liked: boolean
  author: Author
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин`
  if (s < 86400) return `${Math.floor(s / 3600)} ч`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} д`
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

function Avatar({ a }: { a: Author }) {
  return a.avatar ? (
    <img className="av" src={a.avatar} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="av ph" style={{ background: `hsl(${[...a.id].reduce((x, c) => x + c.charCodeAt(0), 0) % 360} 55% 62%)` }}>
      {a.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Item({ r, onReply, onChange, small }: { r: Review; onReply: (r: Review) => void; onChange: (r: Review) => void; small?: boolean }) {
  const { session } = useAuth()
  const like = async () => {
    if (!session) return (location.hash = '#/login?next=' + encodeURIComponent(location.hash.slice(1)))
    onChange({ ...r, liked: !r.liked, likes: r.likes + (r.liked ? -1 : 1) })
    const { data, error } = await (await sb()).rpc('toggle_like', { p_id: r.id })
    if (error) toast(errText(error))
    else onChange({ ...r, liked: data.liked, likes: data.likes })
  }
  const del = async () => {
    const { error } = await (await sb()).rpc('delete_review', { p_id: r.id })
    if (error) toast(errText(error))
    else onChange({ ...r, deleted: true, body: null })
  }
  return (
    <div className={'rv' + (small ? ' small' : '')}>
      <Avatar a={r.author} />
      <div className="rv-main">
        <div className="rv-name">
          {r.author.name}
          {r.author.badge === 'grandchef' && <span className="gc-badge">👑 Grand Chef</span>}
          {r.rating ? <span className="rv-stars">{'★'.repeat(r.rating)}</span> : null}
        </div>
        <div className={'rv-body' + (r.deleted ? ' gone' : '')}>
          {r.reply_to_name && r.root_id && r.reply_to !== r.root_id && <span className="rv-to">@{r.reply_to_name} </span>}
          {r.deleted ? 'Комментарий удалён' : r.body}
        </div>
        <div className="rv-meta">
          <span>{ago(r.created_at)}</span>
          {!r.deleted && (
            <button className="rv-act" onClick={() => onReply(r)}>
              Ответить
            </button>
          )}
          {r.mine && !r.deleted && (
            <button className="rv-act" onClick={del}>
              Удалить
            </button>
          )}
        </div>
      </div>
      <button className={'rv-like' + (r.liked ? ' on' : '')} onClick={like} aria-label="Нравится">
        <span>{r.liked ? '♥' : '♡'}</span>
        <small>{r.likes || ''}</small>
      </button>
    </div>
  )
}

function Thread({ root, onReply, onChange, fresh }: { root: Review; onReply: (r: Review) => void; onChange: (r: Review) => void; fresh: Review[] }) {
  const [open, setOpen] = useState(false)
  const [replies, setReplies] = useState<Review[]>([])
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    const { data } = await (await sb()).rpc('list_replies', { p_root: root.id, p_offset: replies.length })
    setReplies((x) => [...x, ...((data as Review[]) || []).filter((d) => !x.some((y) => y.id === d.id))])
    setOpen(true)
    setLoading(false)
  }
  const shown = [...replies, ...fresh.filter((f) => !replies.some((r) => r.id === f.id))]
  const hidden = root.replies - shown.length
  return (
    <div className="thread">
      <Item r={root} onReply={onReply} onChange={onChange} />
      {(open || fresh.length > 0) && (
        <div className="replies">
          {shown.map((r) => (
            <Item key={r.id} r={r} small onReply={onReply} onChange={(n) => setReplies((x) => x.map((y) => (y.id === n.id ? n : y)))} />
          ))}
        </div>
      )}
      {hidden > 0 && (
        <button className="more-replies" onClick={load} disabled={loading}>
          <span className="line" />
          {open ? `Ещё ответы (${hidden})` : `Посмотреть ответы (${hidden})`} ⌄
        </button>
      )}
    </div>
  )
}

export default function Reviews({ recipeId }: { recipeId: string }) {
  const { session } = useAuth()
  const [items, setItems] = useState<Review[]>([])
  const [meta, setMeta] = useState<{ total: number; avg: number | null; votes: number }>({ total: 0, avg: null, votes: 0 })
  const [sort, setSort] = useState<'top' | 'new'>('top')
  const [text, setText] = useState('')
  const [rating, setRating] = useState(0)
  const [replyTo, setReplyTo] = useState<Review | null>(null)
  const [fresh, setFresh] = useState<Record<string, Review[]>>({})
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!configured) return
    const { data } = await (await sb()).rpc('list_reviews', { p_recipe: recipeId, p_sort: sort, p_offset: 0 })
    if (data) {
      setItems(data.items)
      setMeta({ total: data.total, avg: data.avg, votes: data.votes })
    }
  }, [recipeId, sort])
  useEffect(() => {
    load()
    setFresh({})
  }, [load])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const { data, error } = await (await sb()).rpc('post_review', {
      p_recipe: recipeId,
      p_body: text.trim(),
      p_rating: replyTo ? null : rating || null,
      p_reply_to: replyTo?.id ?? null,
    })
    setBusy(false)
    if (error) return toast(errText(error))
    const r = data as Review
    if (r.root_id) {
      setFresh((f) => ({ ...f, [r.root_id!]: [...(f[r.root_id!] || []), r] }))
      setItems((x) => x.map((i) => (i.id === r.root_id ? { ...i, replies: i.replies + 1 } : i)))
    } else setItems((x) => [r, ...x])
    setText('')
    setRating(0)
    setReplyTo(null)
  }

  return (
    <section className="reviews" id="reviews">
      <div className="reviews-head">
        <h2>
          Отзывы <span className="muted">{meta.total || ''}</span>
        </h2>
        {meta.avg && (
          <div className="avg">
            <b>★ {meta.avg}</b> <span className="muted">· {meta.votes} оценок</span>
          </div>
        )}
        <div className="tabs small">
          <button className={sort === 'top' ? 'on' : ''} onClick={() => setSort('top')}>
            Лучшие
          </button>
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>
            Новые
          </button>
        </div>
      </div>

      {session ? (
        <form className="rv-form" onSubmit={send}>
          {replyTo ? (
            <div className="replying">
              Ответ для <b>@{replyTo.author.name}</b>
              <button type="button" className="icon-btn" onClick={() => setReplyTo(null)}>
                ✕
              </button>
            </div>
          ) : (
            <div className="rate-pick">
              Ваша оценка:
              {[1, 2, 3, 4, 5].map((s) => (
                <button type="button" key={s} className={rating >= s ? 'on' : ''} onClick={() => setRating(s)} aria-label={`${s} из 5`}>
                  ★
                </button>
              ))}
            </div>
          )}
          <div className="rv-input">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={replyTo ? 'Ваш ответ…' : 'Как получилось? Что поменяли бы? Поделитесь — это поможет другим.'}
            />
            <button className="btn primary" disabled={busy || !text.trim()}>
              ↑
            </button>
          </div>
        </form>
      ) : (
        <a className="rv-login" href={'#/login?next=' + encodeURIComponent(location.hash.slice(1))}>
          Войдите, чтобы оставить отзыв и отвечать другим →
        </a>
      )}

      {items.length === 0 ? (
        <p className="muted center">Отзывов пока нет — станьте первым, кто приготовил это блюдо!</p>
      ) : (
        <div className="rv-list">
          {items.map((r) => (
            <Thread
              key={r.id}
              root={r}
              fresh={fresh[r.id] || []}
              onChange={(n) => setItems((x) => x.map((y) => (y.id === n.id ? n : y)))}
              onReply={(t) => {
                setReplyTo(t)
                setTimeout(() => inputRef.current?.focus(), 30)
                document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' })
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
