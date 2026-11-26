import { useCallback, useEffect, useState } from 'react'
import { fmtUntil, planByCode, PLANS } from '../plans'
import { configured, devMode, errText, sb, useAuth } from '../supa'
import { Empty, toast } from '../ui'
import Moderation from './Moderation'
import { pendingRecipes } from '../userRecipes'

type Overview = {
  users: number
  active_subs: Record<string, number>
  reviews: number
  flags: { email: string; reason: string; until: string }[]
  recent: { id: string; email: string; plan: string; expires_at: string | null; source: string; created_at: string }[]
}

const REASONS: Record<string, string> = { bulk_day: 'массовое открытие рецептов за сутки' }
const SOURCES: Record<string, string> = { payhip: 'оплата', admin: 'выдано вручную', lifetime: 'навсегда', telegram: 'Telegram' }
const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Admin() {
  const { access, loaded, email } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [gEmail, setGEmail] = useState('')
  const [gPlan, setGPlan] = useState('grandchef')
  const [gDays, setGDays] = useState(30)
  const [uEmail, setUEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'mod'>(() => (location.hash.includes('tab=mod') ? 'mod' : 'overview'))
  const [modCount, setModCount] = useState<number | null>(null)
  useEffect(() => {
    if (access.admin || devMode) pendingRecipes().then((l) => setModCount(l.length)).catch(() => {})
  }, [access.admin])

  const load = useCallback(async () => {
    if (!configured || !access.admin) return
    const { data, error } = await (await sb()).rpc('admin_overview')
    if (error) setLoadErr(errText(error))
    else {
      setData(data as Overview)
      setLoadErr(null)
    }
  }, [access.admin])
  useEffect(() => {
    load()
  }, [load])

  if (!loaded) return <div className="loading">Проверяем доступ…</div>
  // в dev без сервера показываем макет панели (без данных), чтобы можно было проверить вёрстку
  if (!access.admin && !devMode)
    return (
      <Empty
        icon="🔒"
        title="Только для администраторов"
        text={email ? `Аккаунт ${email} не входит в список администраторов.` : 'Войдите под аккаунтом администратора.'}
        action={
          <a className="btn" href={email ? '#/' : '#/login?next=/admin'}>
            {email ? 'На главную' : 'Войти'}
          </a>
        }
      />
    )

  const call = async (key: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(key)
    const { error } = await fn()
    setBusy(null)
    if (error) toast(errText(error))
    else {
      toast(ok)
      load()
    }
  }

  const grant = (e: React.FormEvent) => {
    e.preventDefault()
    if (!gEmail.trim()) return
    call('grant', async () => (await sb()).rpc('admin_grant', { p_email: gEmail.trim(), p_plan: gPlan, p_days: gDays }), `Выдано: ${planByCode(gPlan)?.name} для ${gEmail.trim()}`)
    setGEmail('')
  }
  const off = !configured

  return (
    <div className="page admin">
      <h1>Админка</h1>
      {off && <p className="warn">Сервер ещё не подключён — данные и действия заработают после запуска Supabase. Ниже — как будет выглядеть панель.</p>}
      <div className="tabs adm-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
          Обзор
        </button>
        <button role="tab" aria-selected={tab === 'mod'} className={tab === 'mod' ? 'on' : ''} onClick={() => setTab('mod')}>
          Модерация{modCount ? <i className="badge">{modCount}</i> : null}
        </button>
      </div>
      {tab === 'mod' ? (
        <Moderation onCount={setModCount} />
      ) : (
      <>
      {loadErr && (
        <p className="form-err" role="alert">
          {loadErr}
        </p>
      )}

      <div className="adm-stats">
        <div>
          <span>Пользователей</span>
          <b>{data ? data.users.toLocaleString('ru') : '—'}</b>
        </div>
        <div>
          <span>Активных подписок</span>
          <b>{data ? Object.values(data.active_subs).reduce((a, b) => a + b, 0) : '—'}</b>
        </div>
        <div>
          <span>Отзывов</span>
          <b>{data ? data.reviews.toLocaleString('ru') : '—'}</b>
        </div>
        <div className={data?.flags.length ? 'alert' : ''}>
          <span>Блокировок</span>
          <b>{data ? data.flags.length : '—'}</b>
        </div>
      </div>

      <section className="adm-card">
        <h2>Подписки по тарифам</h2>
        <div className="adm-plans">
          {PLANS.map((p) => (
            <div key={p.code} className="adm-plan">
              <span aria-hidden>{p.emoji}</span>
              <span>{p.name}</span>
              <b>{data?.active_subs[p.code] ?? (data ? 0 : '—')}</b>
            </div>
          ))}
        </div>
      </section>

      <div className="adm-two">
        <section className="adm-card">
          <h2>Выдать подписку</h2>
          <form className="adm-form" onSubmit={grant}>
            <label className="field">
              <span>E-mail пользователя</span>
              <input type="email" required value={gEmail} onChange={(e) => setGEmail(e.target.value)} placeholder="name@mail.com" disabled={off} />
            </label>
            <div className="adm-row">
              <label className="field">
                <span>Тариф</span>
                <select value={gPlan} onChange={(e) => setGPlan(e.target.value)} disabled={off}>
                  {PLANS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.emoji} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Дней (0 = навсегда)</span>
                <input type="number" min={0} max={3650} value={gDays} onChange={(e) => setGDays(Math.max(0, Number(e.target.value)))} disabled={off} />
              </label>
            </div>
            <div className="chips small">
              {[7, 30, 90, 365, 0].map((d) => (
                <button key={d} type="button" className={'chip' + (gDays === d ? ' on' : '')} onClick={() => setGDays(d)} disabled={off}>
                  {d === 0 ? 'навсегда' : `${d} дн.`}
                </button>
              ))}
            </div>
            <button className="btn primary" disabled={off || busy === 'grant'}>
              {busy === 'grant' ? 'Выдаём…' : 'Выдать'}
            </button>
            <p className="muted small">Пользователь должен быть зарегистрирован. Срок отсчитывается от текущего момента.</p>
          </form>
        </section>

        <section className="adm-card">
          <h2>Блокировки</h2>
          {data?.flags.length ? (
            <ul className="adm-flags">
              {data.flags.map((f) => (
                <li key={f.email}>
                  <div>
                    <b>{f.email}</b>
                    <small>
                      {REASONS[f.reason] || f.reason} · до {fmtDate(f.until)}
                    </small>
                  </div>
                  <button className="btn" disabled={busy === 'u' + f.email} onClick={() => call('u' + f.email, async () => (await sb()).rpc('admin_unflag', { p_email: f.email }), `Блокировка снята: ${f.email}`)}>
                    Снять
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{data ? 'Сейчас никто не заблокирован 👍' : 'Нет данных'}</p>
          )}
          <form
            className="adm-inline"
            onSubmit={(e) => {
              e.preventDefault()
              if (uEmail.trim()) call('unflag', async () => (await sb()).rpc('admin_unflag', { p_email: uEmail.trim() }), `Блокировка снята: ${uEmail.trim()}`)
              setUEmail('')
            }}
          >
            <input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="Снять блокировку по e-mail" aria-label="E-mail для снятия блокировки" disabled={off} />
            <button className="btn" disabled={off || busy === 'unflag'}>
              Снять
            </button>
          </form>
        </section>
      </div>

      <section className="adm-card">
        <h2>Последние подписки</h2>
        {data?.recent.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Тариф</th>
                  <th>Срок</th>
                  <th>Источник</th>
                  <th>Создана</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((s) => {
                  const active = !s.expires_at || new Date(s.expires_at) > new Date()
                  return (
                    <tr key={s.id} className={active ? '' : 'expired'}>
                      <td className="adm-email">{s.email}</td>
                      <td>
                        {planByCode(s.plan)?.emoji} {planByCode(s.plan)?.name || s.plan}
                      </td>
                      <td>{active ? fmtUntil(s.expires_at) : 'истекла'}</td>
                      <td>{SOURCES[s.source] || s.source}</td>
                      <td>{fmtDate(s.created_at)}</td>
                      <td>
                        {active && (
                          <button
                            className="btn ghost danger"
                            disabled={busy === s.id}
                            onClick={() => {
                              if (confirm(`Отозвать ${planByCode(s.plan)?.name} у ${s.email}?`)) call(s.id, async () => (await sb()).rpc('admin_revoke', { p_sub: s.id }), 'Подписка отозвана')
                            }}
                          >
                            Отозвать
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{data ? 'Подписок пока нет' : 'Нет данных'}</p>
        )}
      </section>
      </>
      )}
    </div>
  )
}
