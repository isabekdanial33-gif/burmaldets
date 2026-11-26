// Управление компьютером, как у человека: смотреть (pc_look), действовать мышью и клавиатурой (pc_act), входить в аккаунты (pc_login).
// Экономно: экран передаётся ТЕКСТОМ — пронумерованный список кнопок и полей окна; картинка — только по просьбе модели,
// и тогда на ней те же номера (Set-of-Marks). Несколько действий — за один ход, после них сразу свежий список.
import { askConfirm, RISKY } from './confirm'
import { desk, isDesktop } from './net'
import type { Part } from './llm'

type Obj = Record<string, unknown>
type Box = { i: number; kind: string; name: string; x: number; y: number; w: number; h: number; flags: string }
type Result = { result: Obj; extra?: Part[] }

const call = async (method: string, args: Obj): Promise<Obj> => {
  try {
    return await (desk!.call as (m: string, a: Obj) => Promise<Obj>)(method, args)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

let boxes: Box[] = []
let win = ''
/** Последнее использование рук — пока работаем с компьютером, инструменты нужны модели (в экономном режиме). */
export let pcActiveAt = 0

/** Окна, где Enter или «Отправить» уходит людям: мессенджеры, почта, соцсети, созвоны. */
const PEOPLE = /teams|telegram|whatsapp|discord|slack|outlook|почта|mail|gmail|вконтакте|\bvk\b|viber|skype|zoom|meet|messenger|instagram|max\b|сообщени|чат|chat/i

/** Номера элементов на снимке (как отметки на карте): модель видит, какой номер у какой кнопки. */
async function marks(b64: string, list: Box[], scale: number): Promise<string> {
  try {
    const img = new Image()
    img.src = 'data:image/jpeg;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    g.font = 'bold 13px sans-serif'
    g.textBaseline = 'top'
    for (const b of list.filter((x) => x.kind !== 'текст' && x.kind !== 'картинка').slice(0, 90)) {
      const x = b.x / scale
      const y = b.y / scale
      g.strokeStyle = 'rgba(255,40,120,0.9)'
      g.lineWidth = 1.5
      g.strokeRect(x, y, b.w / scale, b.h / scale)
      const t = String(b.i)
      const w = g.measureText(t).width + 6
      g.fillStyle = 'rgba(255,40,120,0.92)'
      g.fillRect(x, Math.max(0, y - 15), w, 15)
      g.fillStyle = '#fff'
      g.fillText(t, x + 3, Math.max(0, y - 14))
    }
    return c.toDataURL('image/jpeg', 0.66).split(',')[1]
  } catch {
    return b64
  }
}

const keep = (r: Obj) => {
  if (Array.isArray(r.boxes)) boxes = r.boxes as Box[]
  if (typeof r.window === 'string') win = r.window
  delete r.boxes
  pcActiveAt = Date.now()
  return r
}

/** Что из шагов может задеть людей или данные — это решает человек, а не модель. */
function risky(steps: Obj[]): string | null {
  for (const s of steps) {
    const what = String(s.do || '')
    const el = s.el ?? s.i
    const b = el !== undefined && el !== null ? boxes[Number(el) - 1] : undefined
    if (/click/.test(what) && b && RISKY.test(b.name)) return `нажать «${b.name.slice(0, 50)}»`
    const enter = (what === 'type' && s.enter) || (/^(keys|key|press)$/.test(what) && /enter|return/i.test(String(s.keys ?? s.key ?? '')))
    if (enter && PEOPLE.test(win)) return `нажать Enter в «${win.slice(0, 40)}» (может отправить сообщение)`
    if (what === 'type' && PEOPLE.test(win) && /\n/.test(String(s.text || ''))) return `напечатать текст с переносом строки в «${win.slice(0, 40)}»`
  }
  return null
}

export const PC_EXEC: Record<string, (a: Obj) => Promise<Result | Obj>> = {
  async pc_look(a) {
    if (!isDesktop) return { ok: false, note: 'Это работает в приложении «Гудвин» для Windows.' }
    const r = keep(await call('pcLook', { image: !!a.image, window: a.window }))
    if (!r.ok) return r
    const out: Obj = {
      window: r.window,
      windows: r.windows,
      items: r.items || '(элементов не видно — для игр, картинок и холстов посмотри с image: true)',
    }
    if (typeof r.image === 'string') {
      const img = await marks(r.image, boxes, Number(r.scale) || 1)
      out.note = `Снимок экрана приложен (${r.width}×${r.height}). Розовые номера = номера элементов. Если нужного элемента нет в списке — x,y в пикселях этого снимка.`
      return { result: out, extra: [{ inlineData: { mimeType: 'image/jpeg', data: img } }] }
    }
    return out
  },

  async pc_act(a) {
    if (!isDesktop) return { ok: false, note: 'Это работает в приложении «Гудвин» для Windows.' }
    const steps = (Array.isArray(a.steps) ? a.steps : []) as Obj[]
    if (!steps.length) return { ok: false, error: 'нет шагов' }
    const why = a._confirmed ? null : risky(steps)
    if (why) {
      const q = askConfirm(`${why[0].toUpperCase() + why.slice(1)}? Скажите «да» или «нет».`, async () => {
        const r = keep(await call('pcAct', { steps, look: false }))
        return r.ok ? 'Готово.' : `Не получилось: ${String(r.error || 'остановлено')}`
      })
      return { needs_confirmation: true, ask_user_exactly: q, note: 'Действие с последствиями для людей или данных. Задай вопрос дословно и остановись — выполнится само после «да».' }
    }
    const r = keep(await call('pcAct', { steps, look: a.look !== false, settle_ms: a.settle_ms }))
    if (r.human) r.tell_user = 'Человек взял мышь — остановись и спроси, продолжать ли.'
    return r
  },

  async pc_accounts() {
    if (!isDesktop) return { ok: false, note: 'Аккаунты хранятся в приложении для Windows.' }
    const r = await call('accList', {})
    return { ok: true, accounts: r.list, note: (r.list as unknown[])?.length ? 'Пароли тебе не видны — вход делает pc_login.' : 'Сохранённых аккаунтов нет: пользователь добавляет их сам в Настройках → Аккаунты.' }
  },

  async pc_login(a) {
    if (!isDesktop) return { ok: false, note: 'Аккаунты хранятся в приложении для Windows.' }
    const list = ((await call('accList', {})).list || []) as { id: string; name: string; site: string; auto?: boolean }[]
    const q = String(a.account || '').toLowerCase()
    const acc = list.find((x) => x.id === q || x.name.toLowerCase() === q) || list.find((x) => x.name.toLowerCase().includes(q) || (x.site && x.site.toLowerCase().includes(q)))
    if (!acc) return { ok: false, error: 'нет такого сохранённого аккаунта', saved: list.map((x) => x.name), tell_user: 'Аккаунты добавляются в Настройках → Аккаунты.' }
    if (!win) return { ok: false, error: 'сначала открой страницу входа и посмотри на экран (pc_look)' }
    const args = { account: acc.id, login_el: a.login_el, password_el: a.password_el, submit: !!a.submit }
    // «входить самому» включил пользователь — не спрашиваем каждый раз
    if (acc.auto) {
      const r = keep(await call('pcLogin', args))
      return r.ok ? { ...r, note: `Вошёл данными «${acc.name}». Логин и пароль не называй.` } : r
    }
    const question = askConfirm(`Ввести логин и пароль «${acc.name}» в окно «${win.slice(0, 50)}»? Скажите «да» или «нет».`, async () => {
      const r = keep(await call('pcLogin', args))
      return r.ok ? `Вошёл данными «${acc.name}»${args.submit ? '' : ', осталось нажать «Войти»'}.` : `Не получилось: ${String(r.error || '')}`
    })
    return { needs_confirmation: true, ask_user_exactly: question, note: 'Задай вопрос дословно и остановись: логин и пароль введёт приложение после «да». Ты их не видишь и не произносишь.' }
  },
}

const S = (d: string, e?: string[]) => ({ type: 'string', description: d, ...(e ? { enum: e } : {}) })
const N = (d: string) => ({ type: 'number', description: d })
const B = (d: string) => ({ type: 'boolean', description: d })
const fn = (name: string, description: string, props: Obj = {}, required: string[] = []) => ({
  name,
  description,
  parameters: { type: 'object', properties: props, ...(required.length ? { required } : {}) },
})

export const PC_DECLS = [
  fn(
    'pc_look',
    'Посмотреть на экран компьютера: заголовок окна сверху, список его кнопок, полей, ссылок и текстов с номерами (дёшево, текстом) и список открытых окон. image: true — ещё снимок экрана с теми же номерами (дорого: только если текста не хватает — картинки, игры, холсты). window — посмотреть другое окно (номер или часть заголовка).',
    { image: B('Приложить снимок экрана'), window: S('Номер или часть заголовка окна') },
  ),
  fn(
    'pc_act',
    'Мышь и клавиатура как у человека — НЕСКОЛЬКО шагов за один вызов (экономно), после них вернётся свежий список элементов. Номера el — из последнего pc_look/pc_act. Опасное (отправить, удалить, оплатить, Enter в мессенджере) система сама подтвердит у человека.',
    {
      steps: {
        type: 'array',
        description: 'Шаги по порядку',
        items: {
          type: 'object',
          properties: {
            do: S('Действие', ['click', 'right_click', 'double_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'keys', 'focus', 'wait']),
            el: N('Номер элемента (для click, move, scroll, type — щёлкнет в поле перед печатью)'),
            x: N('Или x в пикселях снимка экрана'),
            y: N('Или y в пикселях снимка экрана'),
            to_el: N('drag: куда — номер элемента'),
            to_x: N('drag: куда — x'),
            to_y: N('drag: куда — y'),
            text: S('type: что напечатать'),
            replace: B('type: сначала выделить всё в поле (заменить текст)'),
            enter: B('type: нажать Enter после текста'),
            keys: S('keys: сочетание через +, например «ctrl+c», «alt+tab», «win», «enter», «ctrl+shift+t», «f5»'),
            times: N('keys: сколько раз'),
            direction: S('scroll: куда', ['down', 'up', 'left', 'right']),
            amount: N('scroll: щелчков колеса (по умолчанию 5)'),
            window: S('focus: номер или часть заголовка окна из списка windows'),
            ms: N('wait: миллисекунды'),
          },
          required: ['do'],
        },
      },
      look: B('Вернуть свежий список элементов после шагов (по умолчанию да)'),
    },
    ['steps'],
  ),
  fn('pc_accounts', 'Какие аккаунты сохранены для входа (названия и сайты, без паролей).'),
  fn(
    'pc_login',
    'Войти в сохранённый аккаунт: логин и пароль введёт само приложение (ты их не видишь). Сначала открой страницу входа и сделай pc_look. Спросит подтверждение у человека.',
    { account: S('Название или сайт аккаунта'), login_el: N('Номер поля логина (если курсор не в нём)'), password_el: N('Номер поля пароля (иначе — Tab после логина)'), submit: B('Нажать Enter после пароля') },
    ['account'],
  ),
]
