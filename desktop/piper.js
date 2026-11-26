// Локальный нейроголос Гудвина на ПК: Piper (MIT) + голос «Руслан». Без интернета и без лимитов — всегда один и тот же голос.
// Модель держим загруженной в одном процессе: каждая фраза — строка JSON на вход, готовый WAV — путь на выходе.
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { app } = require('electron')

const dir = () => (app.isPackaged ? path.join(process.resourcesPath, 'piper') : path.join(__dirname, 'piper'))
const MODEL = 'ru_RU-ruslan-medium.onnx'

let proc = null
let ready = null
let queue = Promise.resolve()
let waiting = null
let seq = 0
const tmp = path.join(os.tmpdir(), 'goodwin-voice')

function start() {
  if (ready) return ready
  fs.mkdirSync(tmp, { recursive: true })
  const d = dir()
  const exe = path.join(d, 'piper.exe')
  if (!fs.existsSync(exe)) return Promise.reject(new Error('нет локального голоса'))
  const p = spawn(exe, ['--model', path.join(d, 'voices', MODEL), '--json-input', '--sentence_silence', '0.15'], { cwd: d, windowsHide: true })
  proc = p
  let buf = ''
  p.stdout.on('data', (b) => {
    buf += b.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line && waiting) {
        const w = waiting
        waiting = null
        w(line)
      }
    }
  })
  p.stderr.on('data', () => {}) // Piper пишет в stderr журнал — он нам не нужен
  p.on('exit', () => {
    if (proc === p) {
      proc = null
      ready = null
    }
    if (waiting) {
      const w = waiting
      waiting = null
      w('')
    }
  })
  ready = Promise.resolve()
  return ready
}

/** Озвучить фразу → WAV в base64. Фразы идут по очереди: процесс один. */
function say(text) {
  const job = queue.then(async () => {
    await start()
    const file = path.join(tmp, `s${process.pid}_${++seq}.wav`)
    const done = new Promise((ok) => (waiting = ok))
    proc.stdin.write(JSON.stringify({ text: String(text).replace(/\s+/g, ' ').trim(), output_file: file }) + '\n')
    const timer = new Promise((ok) => setTimeout(() => ok(''), 30000))
    const out = await Promise.race([done, timer])
    if (!out || !fs.existsSync(file)) {
      waiting = null
      throw new Error('голос не ответил')
    }
    const b64 = fs.readFileSync(file).toString('base64')
    fs.rm(file, () => {})
    return b64
  })
  queue = job.catch(() => {})
  return job.then((b64) => ({ b64 }), (e) => ({ error: String(e.message || e) }))
}

/** Прогрев: модель загружается при старте приложения, первая фраза звучит без задержки. */
function warm() {
  start().catch(() => {})
}

function stop() {
  try {
    proc?.kill()
  } catch {
    /* пусто */
  }
}

module.exports = { say, warm, stop }
