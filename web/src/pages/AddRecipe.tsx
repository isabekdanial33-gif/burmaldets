import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, shortMode } from '../data'
import { configured, devMode, errCode, errText, isDevSim, useAuth } from '../supa'
import { loginHref, toast } from '../ui'
import { FULL_MODES, myRecipes, type MyRecipe, normIngredient, normStep, type Problems, splitLines, type Submission, submitRecipe, validate } from '../userRecipes'

type Draft = { title: string; intro: string; category: string; mode: string; temp: string; minutes: string; servings: string; ings: string; steps: string; image: string }
const EMPTY: Draft = { title: '', intro: '', category: 'Курица и птица', mode: '', temp: '', minutes: '', servings: '', ings: '', steps: '', image: '' }
const DKEY = 'mgc:add-draft'

function loadDraft(): Draft {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(DKEY) || '{}') }
  } catch {
    return EMPTY
  }
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const toSubmission = (d: Draft): Submission => ({
  title: d.title.trim(),
  intro: d.intro.trim(),
  category: d.category,
  mode: d.mode,
  temp_c: num(d.temp),
  minutes: num(d.minutes),
  servings: num(d.servings),
  ingredients: splitLines(d.ings).map(normIngredient).filter(Boolean),
  steps: splitLines(d.steps).map(normStep).filter(Boolean),
  image_url: d.image.trim() || null,
})

const STATUS: Record<string, [string, string]> = {
  pending: ['На модерации', 'st-pending'],
  approved: ['Опубликован', 'st-ok'],
  rejected: ['Отклонён', 'st-no'],
}

function MyList({ list }: { list: MyRecipe[] }) {
  if (!list.length) return null
  return (
    <section className="add-mine">
      <h2>Ваши рецепты</h2>
      <ul>
        {list.map((r) => (
          <li key={r.id}>
            <div>
              <b>{r.title}</b>
              <small>
                {new Date(r.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}
                {r.status === 'rejected' && r.reject_reason ? ` · ${r.reject_reason}` : ''}
              </small>
            </div>
            {r.status === 'approved' && r.recipe_id ? (
              <a className={'add-st ' + STATUS.approved[1]} href={`#/r/${r.recipe_id}`}>
                {STATUS.approved[0]} →
              </a>
            ) : (
              <span className={'add-st ' + (STATUS[r.status]?.[1] || '')}>{STATUS[r.status]?.[0] || r.status}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function AddRecipe() {
  const { email, ready } = useAuth()
  // в dev без сервера (и без симуляции аккаунта) форму можно проверить без входа
  const allowed = !!email || (devMode && !isDevSim)
  const [d, setD] = useState<Draft>(loadDraft)
  const [errors, setErrors] = useState<Problems>({})
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [mine, setMine] = useState<MyRecipe[]>([])
  const [imgOk, setImgOk] = useState(true)

  useEffect(() => {
    try {
      localStorage.setItem(DKEY, JSON.stringify(d))
    } catch {
      /* нет места — черновик не сохранится, не страшно */
    }
  }, [d])
  useEffect(() => {
    if (allowed) myRecipes().then(setMine).catch(() => {})
  }, [allowed, sent])

  const sub = useMemo(() => toSubmission(d), [d])
  const set = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p }))
    if (p.image !== undefined) setImgOk(true)
    const keys = Object.keys(p)
    if (keys.length) setErrors((e) => {
      const n = { ...e }
      const map: Record<string, keyof Submission> = { temp: 'temp_c', ings: 'ingredients', image: 'image_url' }
      keys.forEach((k) => delete n[(map[k] || k) as keyof Submission])
      return n
    })
  }

  if (!ready) return <div className="loading">Загружаем…</div>
  if (!allowed)
    return (
      <div className="page narrow add-page">
        <div className="add-guest">
          <div className="add-guest-ico" aria-hidden>
            👨‍🍳
          </div>
          <h1>Поделитесь своим рецептом</h1>
          <p>Готовите в ГрандШефе что-то, что получается лучше всех? Отправьте рецепт — после проверки он появится в каталоге с отметкой «От владельца».</p>
          <a className="btn primary" href={loginHref('/add')}>
            Войти и добавить рецепт
          </a>
          <p className="muted small">Нужен аккаунт — так мы сможем связаться с вами по рецепту и подписать его вашим именем.</p>
        </div>
      </div>
    )

  if (sent)
    return (
      <div className="page narrow add-page">
        <div className="add-done">
          <div className="add-done-ico" aria-hidden>
            ⏳
          </div>
          <h1>Рецепт на модерации</h1>
          <p>
            Спасибо! Мы проверим режим, температуру и время и опубликуем рецепт в каталоге — обычно в течение пары дней. Статус виден ниже, в
            «Ваших рецептах».
          </p>
          <div className="add-done-actions">
            <button className="btn primary" onClick={() => setSent(false)}>
              Добавить ещё рецепт
            </button>
            <a className="btn" href="#/catalog">
              В каталог
            </a>
          </div>
          {!configured && <p className="muted small">Локальный тест: рецепт сохранён в этом браузере, одобрить его можно в «Админке» → «Модерация».</p>}
        </div>
        <MyList list={mine} />
      </div>
    )

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setFail(null)
    const v = validate(sub)
    setErrors(v)
    if (Object.keys(v).length) {
      const first = Object.keys(v)[0]
      document.getElementById('add-' + first)?.focus()
      return
    }
    setBusy(true)
    try {
      await submitRecipe(sub)
      localStorage.removeItem(DKEY)
      setD(EMPTY)
      setSent(true)
      window.scrollTo(0, 0)
      toast('Рецепт отправлен на модерацию')
    } catch (err) {
      const c = errCode(err)
      setFail(c === 'rate_limited' ? 'Не больше 10 рецептов в сутки — продолжите завтра.' : c === 'auth_required' ? 'Войдите заново и отправьте ещё раз.' : errText(err))
    } finally {
      setBusy(false)
    }
  }

  const err = (k: keyof Submission) =>
    errors[k] ? (
      <span className="add-err" role="alert" id={'add-' + k + '-err'}>
        {errors[k]}
      </span>
    ) : null
  const inv = (k: keyof Submission) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': 'add-' + k + '-err' } : {})

  return (
    <div className="page narrow add-page">
      <h1>Добавить свой рецепт</h1>
      <p className="add-sub">
        <b>Только рецепты, которые вы сами готовили в ГрандШефе.</b> После проверки модератором рецепт появится в каталоге с отметкой «От владельца».
      </p>

      <form className="add-form" onSubmit={send} noValidate>
        <label className="field">
          <span>Название *</span>
          <input id="add-title" value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="Например: Куриные бёдра в медово-горчичном соусе" {...inv('title')} />
          {err('title')}
        </label>

        <label className="field">
          <span>Пара слов о блюде</span>
          <textarea id="add-intro" value={d.intro} onChange={(e) => set({ intro: e.target.value })} maxLength={1000} rows={2} placeholder="Чем хорош рецепт, на сколько человек, советы" {...inv('intro')} />
          {err('intro')}
        </label>

        <div className="add-row">
          <label className="field">
            <span>Категория</span>
            <select id="add-category" value={d.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Режим ГрандШефа *</span>
            <select id="add-mode" value={d.mode} onChange={(e) => set({ mode: e.target.value })} {...inv('mode')}>
              <option value="">— выберите —</option>
              {FULL_MODES.map((m) => (
                <option key={m} value={m}>
                  {shortMode(m)} · {m.split(' / ')[1]}
                </option>
              ))}
            </select>
            {err('mode')}
          </label>
        </div>

        <div className="add-row three">
          <label className="field">
            <span>Темп., °C</span>
            <input id="add-temp_c" inputMode="numeric" value={d.temp} onChange={(e) => set({ temp: e.target.value.replace(/[^\d]/g, '') })} placeholder="напр. 180" {...inv('temp_c')} />
            {err('temp_c')}
          </label>
          <label className="field">
            <span>Время, мин</span>
            <input id="add-minutes" inputMode="numeric" value={d.minutes} onChange={(e) => set({ minutes: e.target.value.replace(/[^\d]/g, '') })} placeholder="напр. 25" {...inv('minutes')} />
            {err('minutes')}
          </label>
          <label className="field">
            <span>Порций</span>
            <input id="add-servings" inputMode="numeric" value={d.servings} onChange={(e) => set({ servings: e.target.value.replace(/[^\d]/g, '') })} placeholder="напр. 4" {...inv('servings')} />
            {err('servings')}
          </label>
        </div>

        <label className="field">
          <span>
            Ингредиенты * <em>по одному на строку: «Название — количество»</em>
          </span>
          <textarea
            id="add-ingredients"
            value={d.ings}
            onChange={(e) => set({ ings: e.target.value })}
            rows={6}
            placeholder={'Куриные бёдра — 800 г\nМёд — 2 ст. л.\nГорчица зернистая — 1 ст. л.\nСоль, перец — по вкусу'}
            {...inv('ingredients')}
          />
          <small className="add-count">{sub.ingredients.length ? `${sub.ingredients.length} шт.` : ''}</small>
          {err('ingredients')}
        </label>

        <label className="field">
          <span>
            Шаги приготовления * <em>каждый шаг — с новой строки</em>
          </span>
          <textarea
            id="add-steps"
            value={d.steps}
            onChange={(e) => set({ steps: e.target.value })}
            rows={6}
            placeholder={'Смешайте мёд, горчицу и специи, обмажьте бёдра.\nВыложите на решётку, режим АЭРОГРИЛЬ, 200 °C, 25 минут.\nПереверните на 15-й минуте.'}
            {...inv('steps')}
          />
          <small className="add-count">{sub.steps.length ? `${sub.steps.length} ${sub.steps.length === 1 ? 'шаг' : sub.steps.length < 5 ? 'шага' : 'шагов'}` : ''}</small>
          {err('steps')}
        </label>

        <label className="field">
          <span>Ссылка на фото (https://…)</span>
          <input id="add-image_url" type="url" inputMode="url" value={d.image} onChange={(e) => set({ image: e.target.value })} placeholder="https://…/photo.jpg" {...inv('image_url')} />
          {err('image_url')}
        </label>
        {/^https:\/\/\S+$/.test(d.image.trim()) && (
          <div className="add-preview">
            {imgOk ? <img src={d.image.trim()} alt="Предпросмотр фото" onError={() => setImgOk(false)} referrerPolicy="no-referrer" /> : <span>Не удалось загрузить картинку по ссылке — проверьте, что это прямая ссылка на фото.</span>}
          </div>
        )}

        {fail && (
          <p className="form-err" role="alert">
            {fail}
          </p>
        )}
        <div className="add-go">
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Отправляем…' : 'Отправить на модерацию'}
          </button>
          <span className="muted small">Черновик сохраняется на этом устройстве автоматически.</span>
        </div>
      </form>
      <MyList list={mine} />
    </div>
  )
}
