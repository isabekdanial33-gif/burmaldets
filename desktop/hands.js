// «Руки» Гудвина: мышь, клавиатура и «зрение» через список элементов окна (UI Automation).
// Экономно: модель видит не картинку экрана, а короткий текст «12 кнопка «Сохранить»» — в десятки раз меньше токенов,
// и делает несколько действий за один ход. Картинка экрана — только когда без неё никак (pc_look image).
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { app, screen, desktopCapturer } = require('electron')

const PS_HOST = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -Path $env:BM_HANDS_CS -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase
[BmHands]::Init()
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $c = $line | ConvertFrom-Json
    $r = $null
    switch ($c.op) {
      'pos'     { $r = [BmHands]::Pos() }
      'size'    { $r = [BmHands]::ScreenSize() }
      'move'    { [BmHands]::MoveHuman([int]$c.x, [int]$c.y, [double]$c.speed) }
      'click'   { [BmHands]::Click([string]$c.button, [int]$c.count) }
      'button'  { [BmHands]::Button([string]$c.button, [bool]$c.down) }
      'scroll'  { [BmHands]::Scroll([int]$c.n, [bool]$c.h) }
      'type'    { [BmHands]::Type([string]$c.text, [double]$c.cps) }
      'combo'   { [BmHands]::Combo([uint16[]]@($c.vks)) }
      'windows' { $r = [BmHands]::Windows([uint32]$c.pid) }
      'target'  { $r = [BmHands]::Target([uint32]$c.pid) }
      'focus'   { $r = [BmHands]::Focus([long]$c.hwnd) }
      'ui'      { $r = [BmHands]::Ui([long]$c.hwnd, [int]$c.max, [int]$c.ms) }
      'fg'      { $h = [BmHands]::Fg(); $r = @($h, [BmHands]::Pid($h), [BmHands]::TitleOf($h)) }
      'pid'     { $r = [BmHands]::Pid([long]$c.hwnd) }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 @{ id = $c.id; ok = $true; r = $r }))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ id = $c.id; ok = $false; error = $_.Exception.Message }))
  }
}
`

const VK = {
  ctrl: 0x11, control: 0x11, ctl: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, meta: 0x5b, cmd: 0x5b,
  enter: 0x0d, return: 0x0d, esc: 0x1b, escape: 0x1b, tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e,
  insert: 0x2d, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, pgup: 0x21, pgdn: 0x22,
  capslock: 0x14, printscreen: 0x2c, menu: 0x5d, apps: 0x5d,
  volumeup: 0xaf, volumedown: 0xae, mute: 0xad, playpause: 0xb3, next: 0xb0, prev: 0xb1,
  '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf, '\\': 0xdc, '`': 0xc0,
}
function vk(k) {
  const s = String(k).trim().toLowerCase()
  if (VK[s] !== undefined) return VK[s]
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(s)) return 0x6f + Number(s.slice(1))
  if (/^[a-z0-9]$/.test(s)) return s.toUpperCase().charCodeAt(0)
  // русская раскладка: клавиши с теми же местами (ctrl+с → ctrl+c)
  const ru = 'йцукенгшщзфывапролдячсмить'
  const en = 'qwertyuiopasdfghjklzxcvbnm'
  const i = ru.indexOf(s)
  if (i >= 0) return en[i].toUpperCase().charCodeAt(0)
  throw new Error('неизвестная клавиша: ' + k)
}
const parseKeys = (keys) => (Array.isArray(keys) ? keys : String(keys).split(/\s*\+\s*/)).filter(Boolean).map(vk)

class Hands {
  constructor() {
    this.proc = null
    this.ready = null
    this.seq = 0
    this.wait = new Map()
    this.items = [] // последний список элементов (номер → прямоугольник)
    this.hwnd = 0 // окно, с которым работаем
    this.shot = null // последний снимок экрана: как пересчитать его пиксели в экранные
    this.stopped = 0
    this.last = null // куда мы сами поставили курсор — чтобы заметить, что человек взял мышь
  }

  start() {
    if (this.ready) return this.ready
    const cs = app.isPackaged ? path.join(process.resourcesPath, 'hands.cs') : path.join(__dirname, 'hands.cs')
    // скрипт — в параметре запуска, а не через stdin: stdin целиком отдан под команды
    const enc = Buffer.from(PS_HOST, 'utf16le').toString('base64')
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
      windowsHide: true,
      env: { ...process.env, BM_HANDS_CS: cs },
    })
    this.proc = p
    let buf = ''
    this.ready = new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error('руки не запустились')), 30000)
      p.stdout.on('data', (d) => {
        buf += d.toString('utf8')
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line.startsWith('{')) continue
          let m
          try {
            m = JSON.parse(line)
          } catch {
            continue
          }
          if (m.ready) {
            clearTimeout(t)
            ok()
            continue
          }
          const w = this.wait.get(m.id)
          if (w) {
            this.wait.delete(m.id)
            m.ok ? w.ok(m.r) : w.no(new Error(m.error))
          }
        }
      })
      p.stderr.on('data', (d) => console.warn('[hands]', d.toString().slice(0, 300)))
      p.on('exit', () => {
        clearTimeout(t)
        no(new Error('руки остановлены'))
        for (const w of this.wait.values()) w.no(new Error('остановлено'))
        this.wait.clear()
        if (this.proc === p) {
          this.proc = null
          this.ready = null
        }
      })
    })
    this.ready.catch(() => {})
    return this.ready
  }

  async cmd(op, args = {}, timeoutMs = 20000) {
    await this.start()
    const id = ++this.seq
    return new Promise((ok, no) => {
      const t = setTimeout(() => (this.wait.delete(id), no(new Error('долго: ' + op))), timeoutMs)
      this.wait.set(id, { ok: (v) => (clearTimeout(t), ok(v)), no: (e) => (clearTimeout(t), no(e)) })
      this.proc.stdin.write(JSON.stringify({ id, op, ...args }) + '\n')
    })
  }

  /** Аварийная остановка: убиваем процесс-«руки» посреди движения; следующий вызов поднимет его заново. */
  stop() {
    this.stopped++
    const p = this.proc
    this.proc = null
    this.ready = null
    try {
      p?.kill()
    } catch {
      /* пусто */
    }
  }

  // ---------- смотреть ----------
  async windows() {
    const raw = (await this.cmd('windows', { pid: process.pid })) || ''
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [h, title, min] = l.split('\t')
        return { hwnd: Number(h), title, minimized: min === '1' }
      })
  }

  /** Что на экране: окно сверху (не Гудвин) и его кнопки, поля, ссылки, тексты — коротким пронумерованным списком. */
  async look(opts = {}) {
    let hwnd = Number(opts.hwnd) || Number(await this.cmd('target', { pid: process.pid })) || 0
    const wins = await this.windows()
    if (!hwnd && wins.length) hwnd = wins[0].hwnd
    this.hwnd = hwnd
    const raw = hwnd ? (await this.cmd('ui', { hwnd, max: Math.min(220, Number(opts.max) || 140), ms: 2500 }, 15000)) || '' : ''
    this.items = raw
      .split('\n')
      .filter(Boolean)
      .map((l, i) => {
        const [kind, name, x, y, w, h, flags] = l.split('\t')
        return { i: i + 1, kind, name, x: +x, y: +y, w: +w, h: +h, flags: flags || '' }
      })
    const win = wins.find((w) => w.hwnd === hwnd)
    return { window: win ? win.title : '', items: this.items, windows: wins }
  }

  /** Снимок экрана с тем окном, где работаем (JPEG, ширина до 1280 — экономно). Запоминаем масштаб для кликов по картинке. */
  async screenshot(maxW = 1280) {
    const d = screen.getPrimaryDisplay()
    const pw = Math.round(d.size.width * d.scaleFactor)
    const ph = Math.round(d.size.height * d.scaleFactor)
    const w = Math.min(maxW, pw)
    const h = Math.round((ph * w) / pw)
    const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } })
    const s = src.find((x) => String(x.display_id) === String(d.id)) || src[0]
    if (!s) throw new Error('нет доступа к экрану')
    const img = s.thumbnail
    const sz = img.getSize()
    this.shot = { w: sz.width, h: sz.height, pw, ph }
    return { image: img.toJPEG(62).toString('base64'), width: sz.width, height: sz.height, scale: pw / sz.width }
  }

  // ---------- действовать ----------
  /** Точка для нажатия: элемент по номеру (чуть в стороне от центра, как живой палец) или координаты с картинки. */
  point(s, prefix = '') {
    const el = s[prefix + 'el'] ?? s[prefix + 'i']
    if (el !== undefined && el !== null && el !== '') {
      const it = this.items[Number(el) - 1]
      if (!it) throw new Error(`элемента ${el} нет — посмотри на экран заново`)
      const jx = (Math.random() - 0.5) * Math.min(it.w * 0.3, 14)
      const jy = (Math.random() - 0.5) * Math.min(it.h * 0.3, 6)
      return { x: Math.round(it.x + it.w / 2 + jx), y: Math.round(it.y + it.h / 2 + jy), it }
    }
    const x = s[prefix + 'x']
    const y = s[prefix + 'y']
    if (x === undefined || y === undefined) return null
    // координаты — в пикселях последнего снимка экрана; без снимка — экранные
    const k = this.shot ? this.shot.pw / this.shot.w : 1
    return { x: Math.round(Number(x) * k), y: Math.round(Number(y) * k) }
  }

  async moveTo(p, speed = 1) {
    await this.cmd('move', { x: p.x, y: p.y, speed })
    this.last = p
  }

  /** Человек двинул мышь сам, пока мы работаем, — сразу отдаём управление. */
  async checkHuman() {
    if (!this.last) return
    const [x, y] = (await this.cmd('pos')) || [0, 0]
    if (Math.hypot(x - this.last.x, y - this.last.y) > 40) {
      this.last = null
      const e = new Error('Вы взяли мышь — остановился.')
      e.human = true
      throw e
    }
  }

  async step(s) {
    const what = String(s.do || s.action || '').toLowerCase()
    const done = { do: what }
    switch (what) {
      case 'click':
      case 'left_click':
      case 'right_click':
      case 'double_click':
      case 'middle_click': {
        const p = this.point(s)
        if (!p) throw new Error('куда нажать? нужен номер элемента (el) или x,y со снимка')
        await this.moveTo(p)
        if (p.it?.flags.includes('d')) done.note = 'элемент выключен (серый)'
        const button = what === 'right_click' ? 'right' : what === 'middle_click' ? 'middle' : 'left'
        await this.cmd('click', { button, count: what === 'double_click' || Number(s.count) === 2 ? 2 : 1 })
        if (p?.it) done.on = `${p.it.kind} «${p.it.name}»`
        return done
      }
      case 'move':
      case 'hover': {
        const p = this.point(s)
        if (!p) throw new Error('куда вести курсор?')
        await this.moveTo(p)
        return done
      }
      case 'drag': {
        const a = this.point(s)
        const b = this.point(s, 'to_')
        if (!a || !b) throw new Error('для перетаскивания нужны откуда (el или x,y) и куда (to_el или to_x,to_y)')
        await this.moveTo(a)
        await this.cmd('button', { button: s.button === 'right' ? 'right' : 'left', down: true })
        await new Promise((r) => setTimeout(r, 90))
        await this.moveTo(b, 0.55)
        await new Promise((r) => setTimeout(r, 70))
        await this.cmd('button', { button: s.button === 'right' ? 'right' : 'left', down: false })
        return done
      }
      case 'scroll': {
        const p = this.point(s)
        if (p) await this.moveTo(p)
        const n = Math.max(1, Math.min(30, Math.round(Number(s.amount) || 5)))
        const dir = String(s.direction || 'down')
        await this.cmd('scroll', { n: dir === 'up' || dir === 'left' ? n : -n, h: dir === 'left' || dir === 'right' })
        return done
      }
      case 'type': {
        const p = this.point(s)
        if (p?.it?.flags.includes('p')) throw new Error('это поле пароля — пароли вводятся только из сохранённых аккаунтов (pc_login)')
        if (p) {
          await this.moveTo(p)
          await this.cmd('click', { button: 'left', count: 1 })
          await new Promise((r) => setTimeout(r, 120))
        }
        const text = String(s.text ?? '')
        if (s.replace) {
          await this.cmd('combo', { vks: [0x11, 0x41] })
          await new Promise((r) => setTimeout(r, 60))
        }
        // как человек, но длинное — быстрее
        await this.cmd('type', { text, cps: text.length > 160 ? 45 : 17 }, 20000 + text.length * 120)
        if (s.enter) await this.cmd('combo', { vks: [0x0d] })
        done.chars = text.length
        return done
      }
      case 'keys':
      case 'key':
      case 'press': {
        const vks = parseKeys(s.keys ?? s.key)
        const times = Math.max(1, Math.min(20, Number(s.times) || 1))
        for (let i = 0; i < times; i++) await this.cmd('combo', { vks })
        return done
      }
      case 'wait': {
        await new Promise((r) => setTimeout(r, Math.max(100, Math.min(8000, Number(s.ms) || 800))))
        return done
      }
      case 'focus':
      case 'window': {
        const wins = await this.windows()
        const q = String(s.window ?? s.title ?? '').toLowerCase()
        const w = /^\d+$/.test(q) ? wins[Number(q) - 1] : wins.find((x) => x.title.toLowerCase().includes(q))
        if (!w) throw new Error('такого окна нет: ' + q)
        const okFocus = await this.cmd('focus', { hwnd: w.hwnd })
        this.hwnd = w.hwnd
        this.pid = await this.cmd('pid', { hwnd: w.hwnd })
        if (!okFocus) done.note = 'окно могло не выйти вперёд'
        done.window = w.title
        return done
      }
      default:
        throw new Error('неизвестное действие: ' + what)
    }
  }

  /** Несколько действий подряд за один ход модели. Человек взял мышь или «Стоп» — прекращаем. */
  /**
   * Защита: действуем только в том окне, которое перед этим «увидели» (или в его же диалоге — тот же процесс).
   * Если впереди оказалось чужое окно (мессенджер, урок, браузер) — ничего не нажимаем и не печатаем.
   */
  async guardWindow() {
    if (!this.hwnd) throw new Error('сначала посмотри на экран (pc_look) — не знаю, в каком окне действовать')
    let [fg, pid, title] = (await this.cmd('fg')) || [0, 0, '']
    if (fg === this.hwnd) return
    if (!this.pid) this.pid = await this.cmd('pid', { hwnd: this.hwnd })
    if (pid && pid === this.pid) {
      // своё же новое окно или диалог («Сохранить как», меню) — работаем в нём
      this.hwnd = fg
      return
    }
    // окно ушло на задний план — пробуем вернуть его, и проверяем ещё раз
    await this.cmd('focus', { hwnd: this.hwnd }).catch(() => {})
    ;[fg, pid, title] = (await this.cmd('fg')) || [0, 0, '']
    if (fg === this.hwnd || (pid && pid === this.pid)) {
      this.hwnd = fg
      return
    }
    const e = new Error(`впереди другое окно («${String(title).slice(0, 50)}») — остановился, чтобы не нажать лишнего. Посмотри на экран заново.`)
    e.guard = true
    throw e
  }

  async act(steps, onStep) {
    // тестовый запуск «только смотреть»: никаких нажатий и печати
    if (process.env.BM_NO_INPUT) return { ok: false, error: 'ввод выключен (тест)', test_steps: steps, done: [] }
    const my = this.stopped
    const results = []
    this.last = null
    if (!this.hwnd) return { ok: false, error: 'сначала посмотри на экран (pc_look) — не знаю, в каком окне действовать', done: [] }
    this.pid = await this.cmd('pid', { hwnd: this.hwnd }).catch(() => 0)
    for (const s of steps.slice(0, 25)) {
      if (my !== this.stopped) return { ok: false, stopped: true, done: results }
      try {
        await this.checkHuman()
        if (!/^(focus|window|wait)$/.test(String(s.do || ''))) await this.guardWindow()
        onStep?.(s)
        results.push(await this.step(s))
        await new Promise((r) => setTimeout(r, Math.max(60, Math.min(3000, Number(s.pause_ms) || 120))))
      } catch (e) {
        if (my !== this.stopped) return { ok: false, stopped: true, done: results }
        return { ok: false, error: String(e.message || e), human: !!e.human, done: results, failed_step: results.length + 1 }
      }
    }
    return { ok: true, done: results }
  }
}

module.exports = { Hands, parseKeys }
