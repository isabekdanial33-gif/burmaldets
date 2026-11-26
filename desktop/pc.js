// Что Гудвин умеет делать на компьютере: сайты и программы, музыка и громкость, таймеры и будильники,
// буфер обмена, снимок экрана, голос Edge. Опасного (удалить, выключить, оплатить) тут нет.
const { app, shell, clipboard, desktopCapturer, Notification, powerMonitor } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// ---------- голос Microsoft Edge (бесплатный, без ключа) ----------
let edge = null
let edgeVoice = ''
/**
 * Сервис Microsoft бывает недоступен (обрывает соединение). Тогда не ждём: одна попытка до 5 с,
 * после сбоя 10 минут Edge не трогаем — сразу говорит голос Windows.
 */
let edgeDownUntil = 0
async function edgeTts(text, voice, rate) {
  if (Date.now() < edgeDownUntil) return { error: 'edge недоступен' }
  const r = await edgeOnce(text, voice, rate)
  if (!r.b64) edgeDownUntil = Date.now() + 10 * 60000
  return r
}
async function edgeOnce(text, voice = 'ru-RU-DmitryNeural', rate = 1) {
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')
    if (!edge || edgeVoice !== voice) {
      edge?.close?.()
      edge = new MsEdgeTTS()
      await edge.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      edgeVoice = voice
    }
    // скорость задаётся при воспроизведении: параметр rate в виде «+0%» сервис Microsoft обрывает (проверено)
    void rate
    const { audioStream } = edge.toStream(text)
    const chunks = []
    // библиотека сообщает «конец»/«обрыв» раньше, чем отдаёт последние куски звука — после любого из них ждём 400 мс
    await new Promise((ok, no) => {
      let fin = 0
      const settle = (e) => {
        if (fin) return
        fin = setTimeout(() => (clearTimeout(t), chunks.length ? ok() : no(e || new Error('empty'))), 400)
      }
      const t = setTimeout(() => settle(new Error('edge timeout')), 5000)
      audioStream.on('data', (c) => chunks.push(c))
      audioStream.on('end', () => settle())
      audioStream.on('close', () => settle())
      audioStream.on('error', (e) => settle(e))
    })
    const buf = Buffer.concat(chunks)
    if (buf.length < 2000) throw new Error('empty')
    return { b64: buf.toString('base64') }
  } catch (e) {
    edge = null
    return { error: String(e && e.message ? e.message : e) }
  }
}

// ---------- клавиши мультимедиа через WScript.Shell ----------
const KEYS = { play: 179, pause: 179, toggle: 179, next: 176, previous: 177, prev: 177, stop: 178, mute: 173, down: 174, up: 175 }
function keys(code, times = 1) {
  return new Promise((ok) => {
    const ps = `$w=New-Object -ComObject WScript.Shell; for($i=0;$i -lt ${Math.max(1, Math.min(60, times))};$i++){ $w.SendKeys([char]${code}) }`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => ok())
  })
}

// ---------- программы: ищем ярлыки в меню «Пуск» ----------
const ALIAS = {
  блокнот: 'notepad.exe', notepad: 'notepad.exe', калькулятор: 'calc.exe', calc: 'calc.exe', проводник: 'explorer.exe', explorer: 'explorer.exe',
  'диспетчер задач': 'taskmgr.exe', paint: 'mspaint.exe', паинт: 'mspaint.exe', 'командная строка': 'cmd.exe', терминал: 'wt.exe',
  настройки: 'ms-settings:', параметры: 'ms-settings:', 'панель управления': 'control.exe',
}
const SITES = {
  youtube: 'https://www.youtube.com', ютуб: 'https://www.youtube.com', ютюб: 'https://www.youtube.com', гугл: 'https://www.google.com', google: 'https://www.google.com',
  вконтакте: 'https://vk.com', вк: 'https://vk.com', почта: 'https://mail.google.com', gmail: 'https://mail.google.com', карты: 'https://yandex.kz/maps',
  'яндекс музыка': 'https://music.yandex.ru', 'youtube music': 'https://music.youtube.com', chatgpt: 'https://chatgpt.com', github: 'https://github.com', гитхаб: 'https://github.com',
  тикток: 'https://www.tiktok.com', tiktok: 'https://www.tiktok.com', инстаграм: 'https://www.instagram.com', instagram: 'https://www.instagram.com', кинопоиск: 'https://www.kinopoisk.ru',
}
const TRANSLIT = { телеграм: 'telegram', телеграмм: 'telegram', дискорд: 'discord', стим: 'steam', спотифай: 'spotify', хром: 'chrome', 'гугл хром': 'chrome', эдж: 'edge', ворд: 'word', эксель: 'excel', зум: 'zoom', вотсап: 'whatsapp', ватсап: 'whatsapp', обс: 'obs', фотошоп: 'photoshop', блендер: 'blender', 'вс код': 'visual studio code', вскод: 'visual studio code' }
let lnkCache = null
function shortcuts() {
  if (lnkCache) return lnkCache
  const dirs = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'), app.getPath('desktop')]
  const out = []
  const walk = (d, depth) => {
    let list = []
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory() && depth < 3) walk(p, depth + 1)
      else if (/\.(lnk|url)$/i.test(e.name) && !/uninstall|удал/i.test(e.name)) out.push({ name: e.name.replace(/\.(lnk|url)$/i, ''), path: p })
    }
  }
  dirs.forEach((d) => walk(d, 0))
  lnkCache = out
  setTimeout(() => (lnkCache = null), 10 * 60000)
  return out
}
async function openApp(name) {
  const q0 = String(name || '').toLowerCase().trim()
  if (!q0) return { ok: false, error: 'какое приложение?' }
  const q = TRANSLIT[q0] || q0
  if (ALIAS[q]) {
    if (ALIAS[q].includes(':')) await shell.openExternal(ALIAS[q])
    else execFile(ALIAS[q], [], { detached: true, windowsHide: false }, () => {})
    return { ok: true, opened: q0 }
  }
  const list = shortcuts()
  const hit = list.find((s) => s.name.toLowerCase() === q) || list.find((s) => s.name.toLowerCase().startsWith(q)) || list.find((s) => s.name.toLowerCase().includes(q))
  if (hit) {
    const err = await shell.openPath(hit.path)
    return err ? { ok: false, error: err } : { ok: true, opened: hit.name }
  }
  if (SITES[q]) {
    await shell.openExternal(SITES[q])
    return { ok: true, opened: q0 + ' (сайт)' }
  }
  return { ok: false, error: 'not_found', note: `На компьютере не нашёл программу «${name}». Могу открыть сайт или поискать в интернете.` }
}

// ---------- таймеры и будильники (пока Гудвин запущен) ----------
const ALARMS = () => path.join(app.getPath('userData'), 'alarms.json')
let alarms = []
let hooks = null
function saveAlarms() {
  try {
    fs.writeFileSync(ALARMS(), JSON.stringify(alarms.filter((a) => a.at > Date.now())))
  } catch {
    /* пусто */
  }
}
function arm(a) {
  const ms = a.at - Date.now()
  if (ms < -60000) return
  setTimeout(() => {
    alarms = alarms.filter((x) => x !== a)
    saveAlarms()
    hooks?.notify(a.kind === 'timer' ? 'Таймер' : 'Будильник', a.label)
    hooks?.say(a.kind === 'timer' ? `Время вышло! ${a.label === 'Гудвин' ? '' : a.label}`.trim() : `Будильник: ${a.label}. Пора!`)
  }, Math.max(0, Math.min(ms, 2147000000)))
}
function restoreAlarms(h) {
  hooks = h
  try {
    alarms = JSON.parse(fs.readFileSync(ALARMS(), 'utf8')).filter((a) => a.at > Date.now() - 60000)
  } catch {
    alarms = []
  }
  alarms.forEach(arm)
}
function addAlarm(kind, at, label) {
  const a = { kind, at, label: label || 'Гудвин' }
  alarms.push(a)
  saveAlarms()
  arm(a)
  return a
}

function notify(title, body, onClick) {
  try {
    const n = new Notification({ title: 'Гудвин · ' + title, body: body || '', silent: false })
    if (onClick) n.on('click', onClick)
    n.show()
  } catch {
    /* пусто */
  }
}

async function screenshot() {
  const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })
  if (!src.length) return { ok: false, error: 'нет доступа к экрану' }
  const img = src[0].thumbnail
  return { ok: true, image: img.toJPEG(78).toString('base64'), width: img.getSize().width }
}

async function call(method, a, h) {
  hooks = h
  switch (method) {
    case 'openUrl': {
      const u = String(a.url || '')
      if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'только http/https' }
      await shell.openExternal(u)
      return { ok: true }
    }
    case 'openApp':
      return openApp(a.name)
    case 'media': {
      const act = String(a.action || 'toggle').toLowerCase()
      const code = KEYS[act] || KEYS[/след|next|skip/.test(act) ? 'next' : /пред|prev|back/.test(act) ? 'previous' : /стоп|stop/.test(act) ? 'stop' : 'toggle']
      await keys(code)
      return { ok: true, action: act }
    }
    case 'volume': {
      const pct = Number(a.percent)
      if (Number.isFinite(pct)) {
        // точной громкости Windows из коробки не даёт — опускаем в ноль и поднимаем шагами по 2%
        await keys(KEYS.down, 50)
        await keys(KEYS.up, Math.round(Math.max(0, Math.min(100, pct)) / 2))
        return { ok: true, percent: Math.round(pct / 2) * 2 }
      }
      const d = String(a.direction || '')
      if (/mute|без звука|выкл/.test(d)) await keys(KEYS.mute)
      else await keys(/down|тише|меньше/.test(d) ? KEYS.down : KEYS.up, 5)
      return { ok: true, direction: d || 'up' }
    }
    case 'setTimer': {
      const sec = Math.round(Number(a.seconds))
      if (!(sec > 0)) return { ok: false, error: 'сколько секунд?' }
      addAlarm('timer', Date.now() + sec * 1000, a.label)
      return { ok: true, where: 'компьютер (уведомление и голос)', seconds: sec }
    }
    case 'setAlarm': {
      const h = Number(a.hour)
      const m = Number(a.minute) || 0
      if (!(h >= 0 && h < 24)) return { ok: false, error: 'на какое время?' }
      const d = new Date()
      d.setHours(h, m, 0, 0)
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
      addAlarm('alarm', d.getTime(), a.label)
      return { ok: true, at: d.toLocaleString('ru-RU'), note: 'Будильник сработает, если Гудвин запущен (он стартует вместе с Windows).' }
    }
    case 'status':
      return { ok: true, device: 'компьютер', on_battery: powerMonitor.isOnBatteryPower(), time: new Date().toLocaleString('ru-RU'), uptime_hours: Math.round(os.uptime() / 360) / 10, memory_free_gb: Math.round(os.freemem() / 1e8) / 10 }
    case 'share':
      clipboard.writeText(String(a.text || ''))
      return { ok: true, note: 'Скопировано в буфер обмена' }
    case 'playMusic': {
      const q = String(a.query || [a.title, a.artist].filter(Boolean).join(' '))
      const url = /yandex|яндекс/i.test(String(a.prefer || '')) ? 'https://music.yandex.ru/search?text=' + encodeURIComponent(q) : 'https://music.youtube.com/search?q=' + encodeURIComponent(q)
      await shell.openExternal(url)
      return { ok: true, service: 'YouTube Music в браузере', playing_query: q }
    }
    case 'navigate':
      await shell.openExternal('https://yandex.kz/maps/?text=' + encodeURIComponent(String(a.place || '')))
      return { ok: true }
    case 'openSettings':
      await shell.openExternal('ms-settings:')
      return { ok: true }
    default:
      return { ok: false, note: 'Это умеет только Гудвин на телефоне. На компьютере могу открыть сайт или программу, управлять музыкой и громкостью, поставить таймер, посмотреть на экран.' }
  }
}

module.exports = { call, edgeTts, screenshot, notify, restoreAlarms }
