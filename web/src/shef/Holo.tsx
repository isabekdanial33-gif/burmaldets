// Голограмма Гудвина: светящаяся сфера из частиц над проектором, глаза с эмоциями, «рот»-волна в такт голосу,
// орбитальные кольца, лучи, сетка пола, сканлайны и лёгкие помехи. Чистый canvas, без библиотек.
import { useEffect, useRef } from 'react'
import type { Emotion } from './brain'
import { level, micLevel } from './speech'
import { getMode, onMode } from './mode'

export type Phase = 'sleep' | 'idle' | 'listen' | 'think' | 'speak'

const COLOR: Record<string, [number, number, number]> = {
  спокойно: [90, 215, 255],
  слушаю: [110, 240, 255],
  думаю: [170, 130, 255],
  радость: [255, 205, 95],
  гордость: [255, 160, 70],
  удивление: [255, 240, 150],
  грусть: [100, 150, 255],
}

/** Мягкое пятно света — рисуем спрайтом, это гораздо быстрее shadowBlur. */
const sprites = new Map<string, HTMLCanvasElement>()
function glowSprite(c0: number[]) {
  const q = c0.map((v) => Math.round(v / 12) * 12)
  const id = q.join(',')
  const have = sprites.get(id)
  if (have) return have
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, `rgba(${Math.min(255, q[0] + 120)},${Math.min(255, q[1] + 120)},${Math.min(255, q[2] + 120)},1)`)
  r.addColorStop(0.25, `rgba(${id},0.45)`)
  r.addColorStop(1, `rgba(${id},0)`)
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  if (sprites.size > 80) sprites.clear()
  sprites.set(id, c)
  return c
}

/** bare — только сфера с лицом на чёрном (для голограммы-пирамиды), onCanvas — отдать холст наружу. */
export default function Holo({ phase, emotion, poke, bare, onCanvas }: { phase: Phase; emotion: Emotion; poke?: number; bare?: boolean; onCanvas?: (c: HTMLCanvasElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ phase, emotion, poke: 0, bare: !!bare })
  const cookHat = useRef(getMode() === 'cook')
  useEffect(() => onMode((m) => (cookHat.current = m === 'cook')), [])
  st.current.phase = phase
  st.current.emotion = emotion
  useEffect(() => {
    st.current.poke = poke || 0
  }, [poke])

  useEffect(() => {
    const cv = ref.current!
    onCanvas?.(cv)
    const g = cv.getContext('2d')!
    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.max(1, w * dpr)
      cv.height = Math.max(1, h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    // точки сферы (спираль Фибоначчи) — равномерно по поверхности
    const N = Math.min(window.innerWidth, window.innerHeight) < 520 ? 760 : 1100
    const px = new Float32Array(N)
    const py = new Float32Array(N)
    const pz = new Float32Array(N)
    const seed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N
      const r = Math.sqrt(1 - y * y)
      const a = i * 2.399963
      px[i] = Math.cos(a) * r
      py[i] = y
      pz[i] = Math.sin(a) * r
      seed[i] = Math.random() * 6.28
    }
    const dust = Array.from({ length: 36 }, () => ({ x: Math.random() * 2 - 1, y: Math.random(), s: 0.3 + Math.random() * 0.7 }))
    const zs: { x: number; y: number; a: number }[] = []
    const waves: { r: number; a: number }[] = []

    let col = [...COLOR.спокойно]
    let look = { x: 0, y: 0 }
    let lookT = { x: 0, y: 0 }
    let nextLook = 0
    let blink = 0
    let nextBlink = performance.now() + 2500
    let lastPoke = 0
    let pokeAmp = 0
    let mouth = 0
    let mic = 0
    let wake = 1
    let spin = 0
    let nextZ = 0
    let nextWave = 0
    let glitchUntil = 0
    let nextGlitch = performance.now() + 4000
    let raf = 0
    let last = performance.now()

    const onPointer = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      lookT = { x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2.2)), y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.45) * 2.2)) }
      nextLook = performance.now() + 2500
    }
    window.addEventListener('pointermove', onPointer)
    window.addEventListener('pointerdown', onPointer)

    const rgba = (a: number, k = 1) => `rgba(${Math.min(255, col[0] * k) | 0},${Math.min(255, col[1] * k) | 0},${Math.min(255, col[2] * k) | 0},${a})`
    const glow = (x: number, y: number, r: number, a: number) => {
      g.globalAlpha = Math.min(1, a)
      g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2)
      g.globalAlpha = 1
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      const { phase: ph, emotion: em } = st.current
      const sleeping = ph === 'sleep'

      // цвет плавно перетекает к эмоции
      const target = sleeping ? [70, 150, 210] : ph === 'think' ? COLOR.думаю : ph === 'listen' ? COLOR.слушаю : COLOR[em] || COLOR.спокойно
      for (let k = 0; k < 3; k++) col[k] += (target[k] - col[k]) * Math.min(1, dt * 3)
      wake += ((sleeping ? 0.45 : 1) - wake) * Math.min(1, dt * 2.5)
      mouth += ((ph === 'speak' ? level.value : 0) - mouth) * Math.min(1, dt * 18)
      mic += ((ph === 'listen' ? micLevel.value : 0) - mic) * Math.min(1, dt * 10)
      spin += dt * (ph === 'think' ? 1.6 : sleeping ? 0.12 : 0.35)

      if (st.current.poke !== lastPoke) {
        lastPoke = st.current.poke
        pokeAmp = 1
        waves.push({ r: 1, a: 0.6 })
      }
      pokeAmp *= Math.exp(-dt * 3)

      // взгляд: за пальцем, иначе осматривается
      if (now > nextLook) {
        lookT = sleeping ? { x: 0, y: 0.3 } : ph === 'think' ? { x: 0.5, y: -0.6 } : { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.5) * 0.6 }
        nextLook = now + 1500 + Math.random() * 2500
      }
      look.x += (lookT.x - look.x) * Math.min(1, dt * 4)
      look.y += (lookT.y - look.y) * Math.min(1, dt * 4)
      if (now > nextBlink) {
        blink = 1
        nextBlink = now + 2200 + Math.random() * 3500
      }
      blink = Math.max(0, blink - dt * 7)

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.globalCompositeOperation = 'source-over'
      g.clearRect(0, 0, w, h)

      const bareM = st.current.bare
      const R = (bareM ? Math.min(w, h) * 0.3 : Math.min(w * 0.265, h * 0.24)) * (0.92 + 0.08 * wake)
      const cx = w / 2
      const cy = (bareM ? h * 0.5 : h * 0.43) + Math.sin(t * 1.1) * R * 0.03
      const baseY = h * 0.43 + R * 1.62

      g.globalCompositeOperation = 'lighter'

      if (!bareM) {
      // пол-сетка в перспективе
      g.lineWidth = 1
      const horizon = baseY
      for (let i = 1; i <= 9; i++) {
        const k = ((i + ((t * 0.25) % 1)) / 9) ** 2
        const y = horizon + k * (h - horizon)
        g.strokeStyle = rgba(0.09 * k * wake)
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(w, y)
        g.stroke()
      }
      for (let i = -10; i <= 10; i++) {
        g.strokeStyle = rgba(0.06 * wake)
        g.beginPath()
        g.moveTo(cx + i * R * 0.12, horizon)
        g.lineTo(cx + i * R * 1.1, h)
        g.stroke()
      }

      // луч проектора
      const beam = g.createLinearGradient(0, baseY, 0, cy - R)
      beam.addColorStop(0, rgba(0.22 * wake))
      beam.addColorStop(1, rgba(0))
      g.fillStyle = beam
      g.beginPath()
      g.moveTo(cx - R * 0.55, baseY)
      g.lineTo(cx - R * 1.35, cy - R * 0.6)
      g.lineTo(cx + R * 1.35, cy - R * 0.6)
      g.lineTo(cx + R * 0.55, baseY)
      g.closePath()
      g.fill()
      // пылинки в луче
      for (const d of dust) {
        d.y += dt * 0.08 * d.s * (ph === 'think' ? 3 : 1)
        if (d.y > 1) {
          d.y = 0
          d.x = Math.random() * 2 - 1
        }
        const yy = baseY - d.y * (baseY - cy + R * 0.6)
        const half = R * (0.55 + d.y * 0.8)
        glow(cx + d.x * half, yy, 2 + d.s * 3, 0.35 * (1 - d.y) * wake)
      }
      // проектор
      glow(cx, baseY, R * 1.1, 0.25 * wake)
      g.strokeStyle = rgba(0.7 * wake)
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(cx, baseY, R * 0.62, R * 0.12, 0, 0, Math.PI * 2)
      g.stroke()
      g.lineWidth = 1
      g.setLineDash([R * 0.08, R * 0.05])
      g.lineDashOffset = -t * R * 0.2
      g.strokeStyle = rgba(0.4 * wake)
      g.beginPath()
      g.ellipse(cx, baseY, R * 0.9, R * 0.17, 0, 0, Math.PI * 2)
      g.stroke()
      g.setLineDash([])

      }
      // ядро
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25)
      core.addColorStop(0, rgba((0.2 + mouth * 0.15 + mic * 0.1) * wake))
      core.addColorStop(0.6, rgba(0.06 * wake))
      core.addColorStop(1, rgba(0))
      g.fillStyle = core
      g.beginPath()
      g.arc(cx, cy, R * 1.25, 0, Math.PI * 2)
      g.fill()

      if (!bareM) {
      // HUD-круг с делениями
      g.save()
      g.translate(cx, cy)
      g.rotate(t * 0.08)
      g.strokeStyle = rgba(0.16 * wake)
      g.lineWidth = 1
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2
        const l = i % 5 === 0 ? R * 0.09 : R * 0.04
        g.beginPath()
        g.moveTo(Math.cos(a) * R * 1.72, Math.sin(a) * R * 1.72)
        g.lineTo(Math.cos(a) * (R * 1.72 - l), Math.sin(a) * (R * 1.72 - l))
        g.stroke()
      }
      g.strokeStyle = rgba(0.3 * wake)
      g.lineWidth = 2
      for (let i = 0; i < 3; i++) {
        g.beginPath()
        g.arc(0, 0, R * 1.82, i * 2.1 - t * 0.3, i * 2.1 - t * 0.3 + 0.9)
        g.stroke()
      }
      g.restore()

      }
      // волны: слушает (в такт микрофону) и касание
      if (ph === 'listen' && now > nextWave) {
        waves.push({ r: 1, a: 0.35 + mic * 0.5 })
        nextWave = now + 700 - mic * 350
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const wv = waves[i]
        wv.r += dt * 0.7
        wv.a -= dt * 0.45
        if (wv.a <= 0) {
          waves.splice(i, 1)
          continue
        }
        g.strokeStyle = rgba(wv.a)
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(cx, cy, R * wv.r, 0, Math.PI * 2)
        g.stroke()
      }

      // орбиты (задняя половина рисуется до сферы, передняя — после)
      const rings = [
        { rx: 1.5, ry: 0.3, tilt: -0.28, sp: 0.6 },
        { rx: 1.32, ry: 0.5, tilt: 0.5, sp: -0.45 },
      ]
      const drawRing = (front: boolean) => {
        for (const [ri, rg] of rings.entries()) {
          g.save()
          g.translate(cx, cy)
          g.rotate(rg.tilt + Math.sin(t * 0.3 + ri) * 0.05)
          g.strokeStyle = rgba((front ? 0.55 : 0.2) * wake)
          g.lineWidth = front ? 1.6 : 1
          g.setLineDash(ri ? [R * 0.2, R * 0.08, R * 0.02, R * 0.08] : [R * 0.5, R * 0.06])
          g.lineDashOffset = t * R * rg.sp * (ph === 'think' ? 4 : 1)
          g.beginPath()
          g.ellipse(0, 0, R * rg.rx, R * rg.ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2)
          g.stroke()
          g.setLineDash([])
          // бегущий огонёк
          const a = t * rg.sp * (ph === 'think' ? 3 : 1.2) + ri * 2
          const s = Math.sin(a)
          if (s > 0 === front) glow(Math.cos(a) * R * rg.rx, s * R * rg.ry, R * 0.09, 0.9 * wake)
          g.restore()
        }
      }
      drawRing(false)

      // сфера из частиц
      const yaw = spin
      const cyw = Math.cos(yaw)
      const syw = Math.sin(yaw)
      const pitch = -0.25 + look.y * 0.1
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const D = 3.4
      // каркас: параллели и меридианы — чтобы читалась объёмная сфера
      const proj = (x: number, y: number, z: number) => {
        const x1 = x * cyw - z * syw
        const z1 = x * syw + z * cyw
        const y2 = y * cp - z1 * sp
        const z2 = y * sp + z1 * cp
        const s = D / (D - z2)
        return [cx + x1 * R * s, cy + y2 * R * s, z2] as const
      }
      g.lineWidth = 1
      const wire = (fn: (u: number) => [number, number, number]) => {
        let prev: readonly [number, number, number] | null = null
        for (let k = 0; k <= 40; k++) {
          const q = fn(k / 40)
          const p = proj(q[0], q[1], q[2])
          if (prev) {
            g.strokeStyle = rgba((0.05 + ((p[2] + 1) / 2) * 0.16) * wake)
            g.beginPath()
            g.moveTo(prev[0], prev[1])
            g.lineTo(p[0], p[1])
            g.stroke()
          }
          prev = p
        }
      }
      for (const lat of [-0.66, -0.33, 0, 0.33, 0.66]) {
        const r = Math.sqrt(1 - lat * lat)
        wire((u) => [Math.cos(u * 6.283) * r, lat, Math.sin(u * 6.283) * r])
      }
      for (let m = 0; m < 6; m++) {
        const a = (m / 6) * Math.PI
        wire((u) => [Math.cos(u * 6.283) * Math.cos(a), Math.sin(u * 6.283), Math.cos(u * 6.283) * Math.sin(a)])
      }
      for (let i = 0; i < N; i++) {
        let x = px[i]
        let y = py[i]
        let z = pz[i]
        // «дыхание», речь, мысли, касание
        let d = 0.03 * Math.sin(x * 3 + t * 1.3) * Math.cos(y * 2 + t)
        if (mouth > 0.01) d += mouth * 0.11 * Math.sin((1 - z) * 9 - t * 14)
        if (mic > 0.01) d += mic * 0.08 * Math.sin(y * 7 + t * 10)
        if (ph === 'think') d += 0.045 * Math.sin(y * 10 + t * 5 + x * 3)
        if (pokeAmp > 0.01) d += pokeAmp * 0.2 * Math.sin(seed[i] * 3 + t * 20)
        const k = 1 + d
        // вращение облака
        const x1 = x * cyw - z * syw
        const z1 = x * syw + z * cyw
        x = x1 * k
        z = z1 * k
        y = y * k
        const y2 = y * cp - z * sp
        const z2 = y * sp + z * cp
        const s = D / (D - z2)
        const sx = cx + x * R * s
        const sy = cy + y2 * R * s
        const depth = (z2 + 1) / 2 // 0 — сзади, 1 — спереди
        const tw = 0.7 + 0.3 * Math.sin(seed[i] + t * 3)
        const a = (0.12 + depth * 0.75) * tw * wake
        const sz = 1.1 + depth * 2.1
        g.fillStyle = rgba(a, 1 + depth * 0.4)
        g.fillRect(sx - sz / 2, sy - sz / 2, sz, sz)
      }

      // лицо: смотрит на человека (по взгляду), не крутится вместе с облаком
      const lx = look.x * 0.35
      const ly = look.y * 0.22 - 0.05
      const face = (fx: number, fy: number) => {
        const zz = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy))
        const x1 = fx + lx * zz
        const y1 = fy + ly * zz
        const s = D / (D - zz)
        return { x: cx + x1 * R * s, y: cy + y1 * R * s }
      }
      const eyeOpen = sleeping ? 0.06 : Math.max(0.08, 1 - Math.sin(Math.min(1, blink) * Math.PI))
      const eyeW = R * 0.15
      const eyeH = R * 0.26
      for (const side of [-1, 1]) {
        const p = face(side * 0.33, -0.12)
        glow(p.x, p.y, R * 0.38, (0.5 + mouth * 0.2) * wake)
        g.fillStyle = 'rgba(255,255,255,0.92)'
        g.strokeStyle = 'rgba(255,255,255,0.92)'
        g.lineCap = 'round'
        g.lineWidth = R * 0.07
        const mood = ph === 'think' ? 'думаю' : ph === 'listen' ? 'слушаю' : em
        if (sleeping) {
          g.beginPath()
          g.arc(p.x, p.y - eyeH * 0.15, eyeW * 0.7, 0.2 * Math.PI, 0.8 * Math.PI)
          g.stroke()
        } else if (mood === 'радость' && blink < 0.1) {
          g.beginPath()
          g.arc(p.x, p.y + eyeH * 0.18, eyeW * 0.75, 1.15 * Math.PI, 1.85 * Math.PI)
          g.stroke()
        } else {
          let ew = eyeW
          let eh = eyeH * eyeOpen
          if (mood === 'удивление') ((ew *= 1.25), (eh *= 1.15))
          if (mood === 'слушаю') ((ew *= 1.1), (eh *= 1.08))
          if (mood === 'гордость') eh *= 0.55
          if (mood === 'думаю' && side === -1) eh *= 0.7
          g.beginPath()
          g.roundRect(p.x - ew / 2, p.y - eh / 2, ew, Math.max(2, eh), Math.min(ew, eh) / 2)
          g.fill()
          if (mood === 'грусть') {
            // опущенные «брови»
            g.lineWidth = R * 0.04
            g.beginPath()
            g.moveTo(p.x - side * ew * 0.9, p.y - eh * 0.75)
            g.lineTo(p.x + side * ew * 0.6, p.y - eh * 0.55 - R * 0.06)
            g.stroke()
          }
        }
      }
      // рот — звуковая волна
      if (!sleeping) {
        const m = face(0, 0.3)
        const half = R * 0.3
        g.strokeStyle = rgba(0.95, 1.5)
        g.lineWidth = R * 0.035
        g.lineCap = 'round'
        g.beginPath()
        const mood = ph === 'think' ? 'думаю' : em
        for (let i = 0; i <= 28; i++) {
          const u = i / 28
          const xx = (u - 0.5) * 2
          const env = 1 - xx * xx
          let yy = mouth * R * 0.13 * env * Math.sin(u * 22 + t * 26) * (0.6 + 0.4 * Math.sin(t * 9 + u * 5))
          if (mouth < 0.05) {
            if (mood === 'радость' || mood === 'гордость') yy += env * R * 0.07
            else if (mood === 'грусть') yy -= env * R * 0.05
            else if (mood === 'удивление') yy += 0
            else yy += env * R * 0.025
          }
          const X = m.x + (mood === 'удивление' && mouth < 0.05 ? xx * half * 0.35 : xx * half)
          const Y = m.y + yy
          if (i) g.lineTo(X, Y)
          else g.moveTo(X, Y)
        }
        g.stroke()
        glow(m.x, m.y, R * 0.35, 0.18 + mouth * 0.4)
      }

      drawRing(true)

      // режим повара — голографический поварской колпак
      if (cookHat.current && !bareM) {
        const tilt = Math.sin(t * 0.9) * 0.04
        g.save()
        g.translate(cx, cy - R * 0.93)
        g.rotate(tilt)
        const a = (0.55 + 0.25 * Math.sin(t * 2.2)) * wake
        g.lineWidth = Math.max(1, R * 0.022)
        g.strokeStyle = rgba(a, 1.4)
        g.fillStyle = rgba(0.07 * wake)
        // околыш
        const bw = R * 0.5
        const bh = R * 0.24
        g.beginPath()
        g.moveTo(-bw, 0)
        g.lineTo(bw, 0)
        g.lineTo(bw * 0.92, -bh)
        g.lineTo(-bw * 0.92, -bh)
        g.closePath()
        g.fill()
        g.stroke()
        // складки
        g.lineWidth = Math.max(1, R * 0.012)
        for (let i = -2; i <= 2; i++) {
          g.beginPath()
          g.moveTo(i * bw * 0.36, -bh * 0.1)
          g.lineTo(i * bw * 0.33, -bh * 0.9)
          g.stroke()
        }
        // пышная «шапка» — один контур из трёх «облачков»
        g.lineWidth = Math.max(1, R * 0.022)
        const P = (x: number, y: number) => [x * R, y * R] as const
        g.beginPath()
        g.moveTo(...P(-0.46, -0.24))
        g.bezierCurveTo(...P(-0.8, -0.3), ...P(-0.8, -0.78), ...P(-0.36, -0.74))
        g.bezierCurveTo(...P(-0.3, -1.06), ...P(0.3, -1.06), ...P(0.36, -0.74))
        g.bezierCurveTo(...P(0.8, -0.78), ...P(0.8, -0.3), ...P(0.46, -0.24))
        g.closePath()
        g.fill()
        g.stroke()
        // складки между «облачками»
        g.lineWidth = Math.max(1, R * 0.014)
        g.beginPath()
        g.moveTo(...P(-0.36, -0.74))
        g.quadraticCurveTo(...P(-0.26, -0.55), ...P(-0.3, -0.36))
        g.moveTo(...P(0.36, -0.74))
        g.quadraticCurveTo(...P(0.26, -0.55), ...P(0.3, -0.36))
        g.stroke()
        g.restore()
        glow(cx, cy - R * 1.6, R * 0.7, 0.22 * wake)
      }

      // спит — плывут «z»
      if (sleeping && now > nextZ) {
        zs.push({ x: cx + R * 0.7, y: cy - R * 0.7, a: 1 })
        nextZ = now + 1400
      }
      g.font = `600 ${Math.round(R * 0.2)}px system-ui, sans-serif`
      for (let i = zs.length - 1; i >= 0; i--) {
        const z = zs[i]
        z.y -= dt * R * 0.25
        z.x += Math.sin(now / 400 + i) * 0.3
        z.a -= dt * 0.33
        if (z.a <= 0 || !sleeping) {
          zs.splice(i, 1)
          continue
        }
        g.fillStyle = rgba(z.a * 0.7, 1.3)
        g.fillText('z', z.x, z.y)
      }

      // помехи голограммы: изредка сдвигаем полосы кадра
      g.globalCompositeOperation = 'source-over'
      if (now > nextGlitch) {
        glitchUntil = now + 90 + Math.random() * 90
        nextGlitch = now + 5000 + Math.random() * 7000
      }
      if (now < glitchUntil && cv.width > 0) {
        g.setTransform(1, 0, 0, 1, 0, 0)
        for (let b = 0; b < 3; b++) {
          const by = Math.random() * cv.height
          const bh = 4 + Math.random() * 18 * dpr
          const off = (Math.random() - 0.5) * 30 * dpr
          g.drawImage(cv, 0, by, cv.width, bh, off, by, cv.width, bh)
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <div className="holo">
      <canvas ref={ref} className="shef-blob" aria-hidden />
      <div className="holo-scan" aria-hidden />
    </div>
  )
}
