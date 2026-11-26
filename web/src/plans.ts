import type { Access, PlanCode } from './supa'

export type Plan = {
  code: PlanCode
  name: string
  price: number
  usd: string
  emoji: string
  color: string
  tagline: string
  features: string[]
  /** Ссылка на оплату Payhip. Пусто — оплата ещё не подключена. */
  checkout: string
}

// Ссылки Payhip заполняются после создания товаров в кабинете Payhip (см. docs/ЗАПУСК.md).
const env = import.meta.env as Record<string, string | undefined>

export const PLANS: Plan[] = [
  {
    code: 'weekday', name: 'Будни', price: 1190, usd: '$2.49', emoji: '⚡', color: '#2f80ed',
    tagline: 'Быстро и просто каждый день',
    features: ['Рецепты до 30 минут', 'Завтраки, супы, гарниры, закуски', 'Таймеры и режим готовки'],
    checkout: env.VITE_PAY_WEEKDAY || '',
  },
  {
    code: 'sweet', name: 'Сладкий', price: 1290, usd: '$2.49', emoji: '🧁', color: '#d9468f',
    tagline: 'Вся выпечка и десерты',
    features: ['Пироги, кексы, чизкейки, торты', 'Сладкие завтраки', 'Режимы ВЫПЕЧКА и ДЕГИДРАТОР'],
    checkout: env.VITE_PAY_SWEET || '',
  },
  {
    code: 'pp', name: 'ПП', price: 1490, usd: '$2.99', emoji: '🥗', color: '#1d8a57',
    tagline: 'Правильное питание без скуки',
    features: ['Все ПП и лёгкие рецепты', 'Вегетарианские и постные', 'КБЖУ на порцию и на 100 г'],
    checkout: env.VITE_PAY_PP || '',
  },
  {
    code: 'gourmet', name: 'Гурман', price: 1990, usd: '$3.99', emoji: '🥩', color: '#b4441c',
    tagline: 'Мясо, птица, рыба и праздничный стол',
    features: ['Стейки, рёбра, утка, рыба', 'Праздничные блюда', 'Гриль, барбекю, су-вид, термощуп'],
    checkout: env.VITE_PAY_GOURMET || '',
  },
  {
    code: 'chef', name: 'Шеф', price: 2490, usd: '$4.99', emoji: '👨‍🍳', color: '#1e1a16',
    tagline: 'Все рецепты без ограничений',
    features: ['Все рецепты каталога', 'Все категории и режимы', 'Новые рецепты каждую неделю'],
    checkout: env.VITE_PAY_CHEF || '',
  },
  {
    code: 'grandchef', name: 'Grand Chef', price: 6990, usd: '$13.99', emoji: '👑', color: '#c8952c',
    tagline: 'Всё + умный шеф-ассистент',
    features: [
      'Все рецепты каталога',
      'Генератор меню на неделю — 100 раз в месяц',
      'Завтрак, обед, ужин и десерт без повторов',
      'Цель по КБЖУ: похудение, поддержание, набор',
      'Список покупок на всю неделю одной кнопкой',
      'Замены ингредиентов и шпаргалки шефа',
      'Золотой значок Grand Chef в отзывах',
    ],
    checkout: env.VITE_PAY_GRANDCHEF || '',
  },
]

export const planByCode = (c: string) => PLANS.find((p) => p.code === c)
export const planNames = (codes: string[]) => codes.map((c) => planByCode(c)?.name || c)

const RANK: PlanCode[] = ['grandchef', 'chef', 'gourmet', 'pp', 'sweet', 'weekday']

/** Активные тарифы пользователя со сроком: until = null — навсегда. Сначала самый «старший». */
export function mySubs(a: Access): { plan: Plan; until: string | null }[] {
  const m = new Map<string, string | null>()
  for (const s of a.subs || []) {
    if (!a.plans.includes(s.plan)) continue
    const prev = m.get(s.plan)
    if (prev === null) continue
    if (s.expires_at === null) m.set(s.plan, null)
    else if (prev === undefined || s.expires_at > prev) m.set(s.plan, s.expires_at)
  }
  // тариф есть, а подписки в списке нет — значит пожизненный доступ (lifetime)
  for (const p of a.plans) if (!m.has(p)) m.set(p, null)
  return RANK.filter((c) => m.has(c)).map((c) => ({ plan: planByCode(c)!, until: m.get(c)! }))
}

export const fmtUntil = (iso: string | null) =>
  iso ? 'до ' + new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : 'навсегда'

/** «6 990» с неразрывным пробелом */
export const fmtPrice = (n: number) => n.toLocaleString('ru').replace(/\s/g, ' ')
