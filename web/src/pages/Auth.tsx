import { useState } from 'react'
import { configured, sb, useAuth } from '../supa'
import { go, toast } from '../ui'

const human = (m: string) =>
  /Invalid login/i.test(m)
    ? 'Неверная почта или пароль'
    : /already registered/i.test(m)
      ? 'Этот e-mail уже зарегистрирован — войдите'
      : /Password should be/i.test(m)
        ? 'Пароль должен быть не короче 6 символов'
        : /Email not confirmed/i.test(m)
          ? 'Подтвердите почту по ссылке из письма'
          : /rate limit/i.test(m)
            ? 'Слишком много попыток, подождите минуту'
            : /provider is not enabled/i.test(m)
              ? 'Вход через Google ещё не включён — войдите по почте'
              : 'Не получилось: ' + m

export default function Auth({ next }: { next: string }) {
  const { session } = useAuth()
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (session)
    return (
      <div className="auth-card">
        <h1>Вы вошли</h1>
        <p className="muted">{session.user.email}</p>
        <a className="btn primary" href={next || '#/'}>
          Продолжить
        </a>
      </div>
    )

  const google = async () => {
    const { error } = await (await sb()).auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' + (next || '#/') } })
    if (error) setMsg(human(error.message))
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'reset') {
        const { error } = await (await sb()).auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/#/account' })
        if (error) throw error
        setMsg('Письмо со ссылкой отправлено, проверьте почту')
      } else if (mode === 'up') {
        const { data, error } = await (await sb()).auth.signUp({ email, password: pass, options: { data: { full_name: name || undefined } } })
        if (error) throw error
        if (!data.session) setMsg('Почти готово! Мы отправили письмо — подтвердите почту и войдите.')
        else {
          toast('Добро пожаловать в MyGrandChef!')
          go(next || '/')
        }
      } else {
        const { error } = await (await sb()).auth.signInWithPassword({ email, password: pass })
        if (error) throw error
        toast('С возвращением!')
        go(next || '/')
      }
    } catch (err) {
      setMsg(human((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-logo">
        <span className="logo-mark">M</span>
      </div>
      <h1>{mode === 'up' ? 'Создать аккаунт' : mode === 'reset' ? 'Восстановить пароль' : 'Вход в MyGrandChef'}</h1>
      <p className="muted">Избранное, дневник, отзывы и подписка — на всех ваших устройствах.</p>
      {!configured && <p className="warn">Сервер ещё не подключён — вход заработает после запуска.</p>}
      {mode !== 'reset' && (
        <>
          <button className="btn google" onClick={google} disabled={!configured}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Продолжить с Google
          </button>
          <div className="or">
            <span>или по почте</span>
          </div>
        </>
      )}
      <form onSubmit={submit} className="auth-form">
        {mode === 'up' && <input placeholder="Как вас зовут" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />}
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        {mode !== 'reset' && (
          <input type="password" placeholder="Пароль (от 6 символов)" value={pass} onChange={(e) => setPass(e.target.value)} required minLength={6} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
        )}
        <button className="btn primary wide" disabled={busy || !configured}>
          {busy ? '…' : mode === 'up' ? 'Зарегистрироваться' : mode === 'reset' ? 'Отправить ссылку' : 'Войти'}
        </button>
      </form>
      {msg && <p className="auth-msg">{msg}</p>}
      <div className="auth-switch">
        {mode === 'in' ? (
          <>
            Нет аккаунта? <button className="link" onClick={() => setMode('up')}>Регистрация</button> ·{' '}
            <button className="link" onClick={() => setMode('reset')}>Забыли пароль?</button>
          </>
        ) : (
          <>
            Уже есть аккаунт? <button className="link" onClick={() => setMode('in')}>Войти</button>
          </>
        )}
      </div>
    </div>
  )
}
