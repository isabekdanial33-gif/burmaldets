// Гудвин для Windows: шар поверх всех окон, панель-разговор рядом с ним, значок в трее, Ctrl+Alt+Пробел.
// «Мозг» (веб-ядро из ../web) живёт в панели постоянно — даже скрытой — и слушает «Гудвин».
const { app, BrowserWindow, ipcMain, protocol, net, Tray, Menu, globalShortcut, screen, session, nativeImage, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const pc = require('./pc')
const { Hands } = require('./hands')
const accounts = require('./accounts')
const piper = require('./piper')
const hands = new Hands()
let phase = 'idle'

// проверка рядом с установленной копией: BM_PROFILE=папка — свой профиль и своя блокировка второго запуска
// профиль (настройки, ключ, чаты) остаётся в прежней папке и после смены имени на «Гудвин»
if (process.env.BM_PROFILE) app.setPath('userData', process.env.BM_PROFILE)
else app.setPath('userData', path.join(app.getPath('appData'), 'Бурмалдец'))
if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId('com.burmaldets.desktop')
// звук и распознавание в фоне не должны «засыпать»
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
if (process.env.BM_MUTE) app.commandLine.appendSwitch('mute-audio')
// проверка без микрофона: BM_FAKE_MIC=путь_к.wav — звук берётся из файла
if (process.env.BM_FAKE_MIC) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.BM_FAKE_MIC)
}

protocol.registerSchemesAsPrivileged([{ scheme: 'bm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const RES = app.isPackaged ? process.resourcesPath : __dirname
const WEB = app.isPackaged ? path.join(RES, 'web') : path.join(__dirname, '..', 'web', 'dist')
const VOSK = path.join(RES, 'vosk')
const PREFS = path.join(app.getPath('userData'), 'prefs.json')
const prefs = (() => {
  try {
    return { orb: true, ...JSON.parse(fs.readFileSync(PREFS, 'utf8')) }
  } catch {
    return { orb: true }
  }
})()
const savePrefs = () => fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 1))

let panel = null
let orb = null
let tray = null
const PW = 440
const PH = 720
const OS = 96

function icon() {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
}

function createPanel() {
  panel = new BrowserWindow({
    width: PW,
    height: PH,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 360,
    minHeight: 520,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Гудвин',
    icon: icon(),
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: false },
  })
  panel.loadURL('bm://app/index.html#/shef')
  panel.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      panel.hide()
    }
  })
  // ссылки — во внешнем браузере
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  panel.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('bm://')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
}

function placePanel() {
  const ob = orb && orb.isVisible() ? orb.getBounds() : null
  const d = screen.getDisplayNearestPoint(ob ? { x: ob.x, y: ob.y } : screen.getCursorScreenPoint()).workArea
  const [w, h] = panel.getSize()
  let x, y
  if (ob) {
    // рядом с шаром, с той стороны, где больше места
    x = ob.x + ob.width / 2 > d.x + d.width / 2 ? ob.x - w - 8 : ob.x + ob.width + 8
    y = ob.y + ob.height / 2 - h / 2
  } else {
    x = d.x + d.width - w - 24
    y = d.y + d.height - h - 24
  }
  x = Math.max(d.x + 8, Math.min(x, d.x + d.width - w - 8))
  y = Math.max(d.y + 8, Math.min(y, d.y + d.height - h - 8))
  panel.setPosition(Math.round(x), Math.round(y))
}

function showPanel() {
  if (!panel) return
  if (!panel.isVisible()) placePanel()
  panel.show()
  panel.focus()
}
function hidePanel() {
  panel?.hide()
}
function emit(name, data) {
  panel?.webContents.executeJavaScript(`window.__shefEvent&&window.__shefEvent(${JSON.stringify(name)},${JSON.stringify(JSON.stringify(data ?? null))})`).catch(() => {})
}
/** Позвали (шар, горячая клавиша, трей): показать панель и сразу слушать. Если он занят делом — это «Стоп». */
function summon() {
  if (phase === 'think' || phase === 'speak' || acting) {
    hands.stop()
    showPanel()
    emit('stop')
    return
  }
  showPanel()
  emit('wake', { sheet: false })
}

/** Пока Гудвин работает мышью, панель прозрачна и пропускает клики — чтобы не закрывать окно, в котором он работает. */
let acting = false
function ghost(on) {
  acting = on
  if (!panel) return
  panel.setOpacity(on ? 0 : 1)
  panel.setIgnoreMouseEvents(on)
  orb?.webContents.send('bm:phase', on ? 'act' : phase)
}
const say = (t) => panel?.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('bm:act',{detail:${JSON.stringify(t)}}))`).catch(() => {})
const stepText = (s) => {
  const d = String(s.do || '')
  const el = s.el ?? s.i
  const it = el !== undefined ? hands.items[Number(el) - 1] : null
  const what = it ? ` «${String(it.name).slice(0, 40)}»` : ''
  return (
    { click: 'Нажимаю', left_click: 'Нажимаю', right_click: 'Правая кнопка', double_click: 'Двойной щелчок', type: 'Печатаю', keys: 'Клавиши', scroll: 'Листаю', drag: 'Перетаскиваю', move: 'Веду курсор', focus: 'Переключаю окно', wait: 'Жду' }[d] || 'Делаю'
  ) + what
}
const itemsText = (look) =>
  look.items
    .map((it) => {
      const f = it.flags
      const tags = [f.includes('f') && 'фокус', f.includes('p') && 'пароль', f.includes('d') && 'выключено', f.includes('on') && 'вкл'].filter(Boolean)
      return `${it.i} ${it.kind}${it.name ? ' «' + it.name + '»' : ''}${tags.length ? ' [' + tags.join(', ') + ']' : ''}`
    })
    .join('\n')

function createOrb() {
  const d = screen.getPrimaryDisplay().workArea
  const pos = prefs.orbPos || { x: d.x + d.width - OS - 18, y: d.y + Math.round(d.height * 0.62) }
  orb = new BrowserWindow({
    width: OS,
    height: OS,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  })
  orb.setAlwaysOnTop(true, 'screen-saver')
  orb.loadFile(path.join(__dirname, 'orb.html'))
  orb.once('ready-to-show', () => prefs.orb !== false && orb.showInactive())
}

function setOrb(on) {
  prefs.orb = on
  savePrefs()
  if (on) orb?.showInactive()
  else orb?.hide()
  buildTray()
}

function buildTray() {
  if (!tray) {
    tray = new Tray(icon().resize({ width: 16, height: 16 }))
    tray.setToolTip('Гудвин — скажите «Гудвин» или Ctrl+Alt+Пробел')
    tray.on('click', () => (panel.isVisible() ? hidePanel() : showPanel()))
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Позвать Гудвина', click: summon },
      { label: 'Открыть панель', click: showPanel },
      { label: prefs.orb !== false ? 'Спрятать шар' : 'Показать шар', click: () => setOrb(prefs.orb === false) },
      { label: 'Запускать вместе с Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) },
      { type: 'separator' },
      { label: 'Выход', click: () => ((app.isQuitting = true), app.quit()) },
    ]),
  )
}

// ---------- мост для веб-ядра ----------
ipcMain.handle('bm:fetch', async (_e, url, o = {}, timeoutMs = 20000) => {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const u = new URL(url)
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/.test(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { status: 400, body: '{"error":"https only"}' }
    const headers = { ...(o.headers || {}) }
    let body = o.body || undefined
    if (headers['x-body-b64']) {
      delete headers['x-body-b64']
      body = Buffer.from(o.body || '', 'base64')
    }
    const r = await fetch(url, { method: o.method || 'GET', headers, body, signal: ctl.signal })
    const type = r.headers.get('content-type') || ''
    if (o.binary && r.ok) return { status: r.status, type, body: '', b64: Buffer.from(await r.arrayBuffer()).toString('base64') }
    return { status: r.status, type, body: await r.text() }
  } catch (e) {
    return { status: 0, body: JSON.stringify({ error: String(e && e.message ? e.message : e) }) }
  } finally {
    clearTimeout(t)
  }
})

ipcMain.handle('bm:tts', (_e, text, voice, rate) => pc.edgeTts(text, voice, rate))
// локальный голос «Руслан» (Piper): всегда один голос, без интернета и лимитов
ipcMain.handle('bm:piper', (_e, text) => piper.say(text))

ipcMain.handle('bm:call', async (_e, method, a = {}) => {
  switch (method) {
    case 'showPanel':
      showPanel()
      return { ok: true }
    case 'hidePanel':
      hidePanel()
      return { ok: true }
    case 'phase':
      phase = a.phase
      if (!acting) orb?.webContents.send('bm:phase', a.phase)
      return { ok: true }
    // ---------- руки: смотреть и действовать мышью и клавиатурой ----------
    case 'pcLook': {
      try {
        let hwnd = 0
        if (a.window) {
          const wins = await hands.windows()
          const q = String(a.window).toLowerCase()
          hwnd = (/^\d+$/.test(q) ? wins[Number(q) - 1] : wins.find((w) => w.title.toLowerCase().includes(q)))?.hwnd || 0
        }
        const look = await hands.look({ hwnd, max: a.max })
        const out = { ok: true, window: look.window, windows: look.windows.slice(0, 12).map((w, i) => `${i + 1}. ${w.title}${w.minimized ? ' (свёрнуто)' : ''}`).join('\n'), items: itemsText(look), boxes: look.items }
        if (a.image) {
          const vis = panel?.isVisible() && !acting
          if (vis) panel.setOpacity(0)
          await new Promise((r) => setTimeout(r, 160))
          try {
            Object.assign(out, await hands.screenshot())
          } finally {
            if (vis) panel.setOpacity(1)
          }
        }
        return out
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    }
    case 'pcAct': {
      const steps = Array.isArray(a.steps) ? a.steps : []
      if (!steps.length) return { ok: false, error: 'нет действий' }
      ghost(true)
      try {
        const r = await hands.act(steps, (s) => say(stepText(s)))
        if (a.look !== false && !r.stopped) {
          await new Promise((res) => setTimeout(res, Math.max(250, Math.min(3000, Number(a.settle_ms) || 450))))
          const look = await hands.look({ hwnd: hands.hwnd })
          Object.assign(r, { window: look.window, items: itemsText(look), boxes: look.items })
        }
        return r
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      } finally {
        ghost(false)
        say('')
      }
    }
    case 'pcStop':
      hands.stop()
      ghost(false)
      return { ok: true }
    // ---------- аккаунты: секреты не покидают главный процесс ----------
    case 'accList':
      return { ok: true, list: accounts.list() }
    case 'accAdd':
      try {
        return { ok: true, list: accounts.add(a) }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    case 'accAuto':
      return { ok: true, list: accounts.setAuto(String(a.id || ''), !!a.on) }
    case 'accRemove':
      return { ok: true, list: accounts.remove(String(a.id || '')) }
    case 'pcLogin': {
      if (process.env.BM_NO_INPUT) return { ok: false, error: 'ввод выключен (тест)' }
      const acc = accounts.find(a.account)
      if (!acc) return { ok: false, error: 'нет такого сохранённого аккаунта', saved: accounts.list().map((x) => x.name) }
      const sec = accounts.secrets(acc)
      ghost(true)
      try {
        // поле логина: по номеру или то, где уже стоит курсор; всё — только в том окне, которое видели
        if (a.login_el) {
          const r1 = await hands.act([{ do: 'click', el: a.login_el }])
          if (!r1.ok) return r1
        }
        await hands.guardWindow()
        await hands.cmd('combo', { vks: [0x11, 0x41] })
        await hands.cmd('type', { text: sec.login, cps: 30 })
        if (a.password_el) {
          const r2 = await hands.act([{ do: 'click', el: a.password_el }])
          if (!r2.ok) return { ok: false, error: r2.error }
        } else {
          await hands.guardWindow()
          await hands.cmd('combo', { vks: [0x09] })
        }
        await new Promise((r) => setTimeout(r, 150))
        await hands.guardWindow()
        await hands.cmd('type', { text: sec.password, cps: 30 })
        if (a.submit) await hands.cmd('combo', { vks: [0x0d] })
        await new Promise((r) => setTimeout(r, 900))
        const look = await hands.look({ hwnd: hands.hwnd })
        return { ok: true, account: acc.name, submitted: !!a.submit, window: look.window, items: itemsText(look), boxes: look.items }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      } finally {
        ghost(false)
      }
    }
    case 'prefs':
      if (typeof a.orb === 'boolean') setOrb(a.orb)
      if (typeof a.autostart === 'boolean') app.setLoginItemSettings({ openAtLogin: a.autostart })
      buildTray()
      return { ok: true, orb: prefs.orb !== false, autostart: app.getLoginItemSettings().openAtLogin }
    case 'screenRead': {
      // прячем саму панель, чтобы на снимке был экран пользователя, а не Гудвин
      const vis = panel?.isVisible()
      if (vis) panel.setOpacity(0)
      await new Promise((r) => setTimeout(r, 180))
      try {
        return await pc.screenshot()
      } finally {
        if (vis) panel.setOpacity(1)
      }
    }
    default:
      return pc.call(method, a, { notify: (title, body) => pc.notify(title, body, summon), say: (text) => (showPanel(), emit('say', text)) })
  }
})

// перетаскивание шара и нажатие на него
let drag = null
ipcMain.on('orb:down', () => {
  const [x, y] = orb.getPosition()
  drag = { x, y, p: screen.getCursorScreenPoint(), moved: false }
})
ipcMain.on('orb:move', () => {
  if (!drag) return
  const p = screen.getCursorScreenPoint()
  const dx = p.x - drag.p.x
  const dy = p.y - drag.p.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  orb.setPosition(drag.x + dx, drag.y + dy)
  if (panel.isVisible()) placePanel()
})
ipcMain.on('orb:up', () => {
  if (!drag) return
  const moved = drag.moved
  drag = null
  if (moved) {
    const [x, y] = orb.getPosition()
    prefs.orbPos = { x, y }
    savePrefs()
  } else if (panel.isVisible() && panel.isFocused()) hidePanel()
  else summon()
})
ipcMain.on('orb:menu', () => tray && tray.popUpContextMenu())

app.whenReady().then(() => {
  // страницы приложения и модель распознавания — из папки программы
  protocol.handle('bm', (req) => {
    const u = new URL(req.url)
    let p = decodeURIComponent(u.pathname).replace(/^\/+/, '')
    const base = p.startsWith('vosk/') ? RES : WEB
    const file = path.normalize(path.join(base, p || 'index.html'))
    if (!file.startsWith(path.normalize(base))) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  // микрофон — для разговора; остальное не нужно
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'clipboard-sanitized-write', 'notifications'].includes(perm)))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'clipboard-sanitized-write', 'notifications'].includes(perm))
  createPanel()
  createOrb()
  piper.warm()
  buildTray()
  globalShortcut.register('Control+Alt+Space', summon)
  pc.restoreAlarms({ notify: (title, body) => pc.notify(title, body, summon), say: (text) => (showPanel(), emit('say', text)) })
  if (process.argv.includes('--show')) panel.once('ready-to-show', showPanel)
})
app.on('second-instance', () => showPanel())
app.on('window-all-closed', (e) => e.preventDefault())
app.on('will-quit', () => (globalShortcut.unregisterAll(), piper.stop()))
