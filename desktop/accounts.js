// Сохранённые аккаунты (как в Джарвисе): логин и пароль шифруются средствами Windows (DPAPI через safeStorage)
// и лежат только на этом компьютере. Модель видит лишь название и сайт — подставляет их само приложение.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

const FILE = () => path.join(app.getPath('userData'), 'accounts.json')
let cache = null

function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    cache = []
  }
  return cache
}
function save() {
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 1))
}
const enc = (s) => safeStorage.encryptString(String(s)).toString('base64')
const dec = (s) => safeStorage.decryptString(Buffer.from(s, 'base64'))

/** Список без секретов: что можно показать и модели, и в настройках. */
const list = () => load().map(({ id, name, site, auto }) => ({ id, name, site, auto: !!auto }))

function add({ name, site, login, password, auto }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать данные — аккаунт не сохранён')
  name = String(name || '').trim()
  if (!name || !login || !password) throw new Error('Нужны название, логин и пароль')
  load()
  const id = crypto.randomUUID().slice(0, 8)
  cache = cache.filter((a) => a.name.toLowerCase() !== name.toLowerCase())
  cache.push({ id, name, site: String(site || '').trim(), login: enc(login), password: enc(password), auto: !!auto })
  save()
  return list()
}
/** «Входить самому без вопроса» — включает и выключает сам пользователь в настройках. */
function setAuto(id, on) {
  load()
  const a = cache.find((x) => x.id === id)
  if (a) a.auto = !!on
  save()
  return list()
}
function remove(id) {
  load()
  cache = cache.filter((a) => a.id !== id)
  save()
  return list()
}
/** Найти по id, названию или сайту («вконтакте», «vk.com»). */
function find(q) {
  const s = String(q || '').toLowerCase().trim()
  const all = load()
  return all.find((a) => a.id === s) || all.find((a) => a.name.toLowerCase() === s) || all.find((a) => a.name.toLowerCase().includes(s) || (a.site && (a.site.toLowerCase().includes(s) || s.includes(a.site.toLowerCase()))))
}
/** Секреты — только для подстановки в главном процессе, наружу (в веб и модели) не уходят. */
function secrets(a) {
  return { login: dec(a.login), password: dec(a.password) }
}

module.exports = { list, add, remove, setAuto, find, secrets }
