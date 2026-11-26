// Желешка Бурмалдеца: мягкое тело на пружинах, глаза с морганием и эмоциями, рот в такт голосу. Чистый canvas, без библиотек.
import { useEffect, useRef } from 'react'
import type { Emotion } from './brain'
import { level } from './speech'

export type Phase = 'sleep' | 'idle' | 'listen' | 'think' | 'speak'

const GLOW: Record<string, string> = {
  радость: '255,196,80',
  гордость: '255,170,60',
  грусть: '90,150,255',
  думаю: '170,120,255',
  удивление: '255,230,120',
  слушаю: '80,220,255',
  спокойно: '255,120,50',
}

export default function Blob({ phase, emotion, poke }: { phase: Phase; emotion: Emotion; poke?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ phase, emotion, poke: 0 })
  st.current.phase = phase
  st.current.emotion = emotion

  useEffect(() => {
    st.current.poke = poke || 0
  }, [poke])

  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const N = 72
    const off = new Float32Array(N)
    const vel = new Float32Array(N)
    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = w * dpr
      cv.height = h * dpr
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    let look = { x: 0, y: 0 }
    let lookT = { x: 0, y: 0 }
    let nextLook = 0
    let blink = 0
    let nextBlink = performance.now() + 2000
    let lastPoke = 0
    let mouth = 0
    let glow = [255, 120, 50]
    const zs: { x: number; y: number; a: number }[] = []
    let nextZ = 0

    const onPointer = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      lookT = { x: Math.max(-1, Math.min(1, (e.clientX - r.left - w / 2) / (w / 3))), y: Math.max(-1, Math.min(1, (e.clientY - r.top - h / 2) / (h / 3))) }
      nextLook = performance.now() + 2500
    }
    window.addEventListener('pointermove', onPointer)

    let raf = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const t = (now - t0) / 1000
      const { phase: ph, emotion: emo } = st.current
      const lv = ph === 'speak' ? level.value : 0
      mouth += (lv - mouth) * 0.35

      // тычок — волна по телу
      if (st.current.poke !== lastPoke) {
        lastPoke = st.current.poke
        const a0 = Math.random() * Math.PI * 2
        for (let i = 0; i < N; i++) vel[i] += Math.cos((i / N) * Math.PI * 2 - a0) * 9
      }
      // пружины: каждая точка тянется к своей «цели» и к соседям
      const amp = ph === 'sleep' ? 0.6 : ph === 'listen' ? 2.2 : ph === 'think' ? 1.8 : ph === 'speak' ? 1.4 + lv * 7 : 1.2
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        let target = amp * (Math.sin(a * 3 + t * 1.7) + 0.6 * Math.sin(a * 5 - t * 2.3) + 0.4 * Math.sin(a * 2 + t * 0.9))
        if (ph === 'think') target += 5 * Math.max(0, Math.cos(a - t * 2.2)) ** 6
        if (ph === 'listen') target += 2.5 * Math.sin(t * 6 + a * 4) * 0.5
        const l = off[(i + N - 1) % N]
        const r = off[(i + 1) % N]
        vel[i] += (target - off[i]) * 0.06 + (l + r - 2 * off[i]) * 0.18
        vel[i] *= 0.86
      }
      for (let i = 0; i < N; i++) off[i] += vel[i]

      // цвет свечения плавно меняется с эмоцией
      const gc = (ph === 'listen' ? GLOW['слушаю'] : GLOW[emo] || GLOW['спокойно']).split(',').map(Number)
      glow = glow.map((v, i) => v + (gc[i] - v) * 0.05)

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const R = Math.min(w, h) * 0.26
      const breath = Math.sin(t * (ph === 'sleep' ? 1.1 : 2)) * (ph === 'sleep' ? 0.025 : 0.035)
      const sy = 1 + breath + mouth * 0.06
      const sx = 1 - breath * 0.7 - mouth * 0.03
      const cx = w / 2
      const cy = h / 2 + Math.sin(t * 1.3) * R * 0.04 + (ph === 'sleep' ? R * 0.08 : 0)
      const tilt = Math.sin(t * 0.8) * 0.04 + (ph === 'listen' ? 0.08 : 0)

      g.save()
      g.translate(cx, cy)
      g.rotate(tilt)
      g.scale(sx, sy)

      // свечение
      const gl = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2)
      const ga = ph === 'sleep' ? 0.12 : 0.32 + mouth * 0.3
      gl.addColorStop(0, `rgba(${glow.map(Math.round).join(',')},${ga})`)
      gl.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gl
      g.fillRect(-R * 2.2, -R * 2.2, R * 4.4, R * 4.4)

      // тело
      g.beginPath()
      for (let i = 0; i <= N; i++) {
        const k = i % N
        const a = (k / N) * Math.PI * 2
        const rr = R + off[k] * R * 0.012
        const p = { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.94 }
        const nk = (k + 1) % N
        const na = (nk / N) * Math.PI * 2
        const nr = R + off[nk] * R * 0.012
        const q = { x: Math.cos(na) * nr, y: Math.sin(na) * nr * 0.94 }
        if (i === 0) g.moveTo((p.x + q.x) / 2, (p.y + q.y) / 2)
        else g.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
      }
      g.closePath()
      const body = g.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.1)
      const dim = ph === 'sleep' ? 0.55 : 1
      body.addColorStop(0, `rgba(255,${Math.round(190 * dim)},${Math.round(120 * dim)},1)`)
      body.addColorStop(0.45, `rgba(${Math.round(255 * dim)},${Math.round(122 * dim)},${Math.round(40 * dim)},1)`)
      body.addColorStop(1, `rgba(${Math.round(170 * dim)},${Math.round(50 * dim)},${Math.round(10 * dim)},1)`)
      g.fillStyle = body
      g.fill()
      // блик
      g.save()
      g.clip()
      const hl = g.createRadialGradient(-R * 0.42, -R * 0.55, 0, -R * 0.42, -R * 0.55, R * 0.55)
      hl.addColorStop(0, 'rgba(255,255,255,0.55)')
      hl.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = hl
      g.fillRect(-R, -R, R * 2, R * 2)
      const rim = g.createRadialGradient(0, R * 0.2, R * 0.7, 0, 0, R * 1.05)
      rim.addColorStop(0, 'rgba(0,0,0,0)')
      rim.addColorStop(1, 'rgba(60,10,0,0.45)')
      g.fillStyle = rim
      g.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4)
      g.restore()

      // ---- лицо ----
      if (now > nextLook) {
        nextLook = now + 1200 + Math.random() * 2600
        lookT = ph === 'think' ? { x: 0.7, y: -0.8 } : ph === 'listen' || ph === 'speak' ? { x: (Math.random() - 0.5) * 0.4, y: 0 } : { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 0.9 }
      }
      look = { x: look.x + (lookT.x - look.x) * 0.12, y: look.y + (lookT.y - look.y) * 0.12 }
      if (now > nextBlink) {
        blink = 1
        nextBlink = now + 1800 + Math.random() * 3500
      }
      blink = Math.max(0, blink - 0.12)
      const open = ph === 'sleep' ? 0 : 1 - Math.sin(blink * Math.PI)

      const ex = R * 0.34
      const ey = -R * 0.12
      const ew = R * 0.16 * (emo === 'удивление' ? 1.2 : 1)
      const eh = R * 0.2 * (emo === 'удивление' ? 1.2 : 1)
      g.lineCap = 'round'
      for (const side of [-1, 1]) {
        const x = side * ex + look.x * R * 0.03
        const y = ey + look.y * R * 0.02
        if (ph === 'sleep') {
          g.strokeStyle = 'rgba(40,10,0,0.85)'
          g.lineWidth = R * 0.04
          g.beginPath()
          g.arc(x, y + R * 0.02, ew * 0.8, 0.15 * Math.PI, 0.85 * Math.PI)
          g.stroke()
          continue
        }
        if (emo === 'радость' || emo === 'гордость') {
          // счастливые глаза-дуги ^ ^
          g.strokeStyle = '#2a0c02'
          g.lineWidth = R * 0.055
          g.beginPath()
          g.arc(x, y + eh * 0.35, ew * 0.85, 1.12 * Math.PI, 1.88 * Math.PI)
          g.stroke()
          continue
        }
        g.save()
        g.translate(x, y)
        g.scale(1, Math.max(0.06, open))
        g.fillStyle = '#fffaf3'
        g.beginPath()
        g.ellipse(0, 0, ew, eh, 0, 0, Math.PI * 2)
        g.fill()
        const pr = ew * (emo === 'удивление' ? 0.42 : 0.55)
        g.fillStyle = '#1b0a04'
        g.beginPath()
        g.ellipse(look.x * ew * 0.38, look.y * eh * 0.38 + (emo === 'грусть' ? eh * 0.25 : 0), pr, pr * 1.08, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.9)'
        g.beginPath()
        g.arc(look.x * ew * 0.38 - pr * 0.35, look.y * eh * 0.38 - pr * 0.4, pr * 0.32, 0, Math.PI * 2)
        g.fill()
        g.restore()
        // веки/брови по эмоции
        g.strokeStyle = '#3a1205'
        g.lineWidth = R * 0.035
        if (emo === 'грусть') {
          g.beginPath()
          g.moveTo(x - side * ew * 1.0, y - eh * 1.25)
          g.lineTo(x + side * ew * 0.9, y - eh * 0.95)
          g.stroke()
        } else if (emo === 'думаю' && side === 1) {
          g.beginPath()
          g.moveTo(x - ew, y - eh * 1.45)
          g.quadraticCurveTo(x, y - eh * 1.85, x + ew, y - eh * 1.4)
          g.stroke()
        } else if (emo === 'удивление') {
          g.beginPath()
          g.arc(x, y - eh * 1.05, ew * 0.9, 1.15 * Math.PI, 1.85 * Math.PI)
          g.stroke()
        }
      }
      // румянец
      if (ph !== 'sleep' && (emo === 'радость' || emo === 'гордость' || mouth > 0.4)) {
        for (const side of [-1, 1]) {
          const bl = g.createRadialGradient(side * R * 0.55, R * 0.12, 0, side * R * 0.55, R * 0.12, R * 0.16)
          bl.addColorStop(0, 'rgba(255,80,90,0.45)')
          bl.addColorStop(1, 'rgba(255,80,90,0)')
          g.fillStyle = bl
          g.fillRect(side * R * 0.55 - R * 0.2, R * 0.12 - R * 0.2, R * 0.4, R * 0.4)
        }
      }
      // рот
      const my = R * 0.22
      g.fillStyle = '#3a0d04'
      g.strokeStyle = '#3a0d04'
      g.lineWidth = R * 0.04
      if (ph === 'speak' && mouth > 0.03) {
        const mw = R * (0.2 + mouth * 0.12)
        const mh = R * (0.03 + mouth * 0.2)
        g.beginPath()
        g.ellipse(0, my, mw, mh, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,110,110,0.85)'
        g.beginPath()
        g.ellipse(0, my + mh * 0.45, mw * 0.55, mh * 0.4, 0, 0, Math.PI * 2)
        g.fill()
      } else if (emo === 'удивление' && ph !== 'sleep') {
        g.beginPath()
        g.ellipse(0, my, R * 0.07, R * 0.09, 0, 0, Math.PI * 2)
        g.fill()
      } else if (emo === 'грусть') {
        g.beginPath()
        g.arc(0, my + R * 0.12, R * 0.14, 1.2 * Math.PI, 1.8 * Math.PI)
        g.stroke()
      } else if (emo === 'думаю' || ph === 'think') {
        g.beginPath()
        g.moveTo(-R * 0.1, my)
        g.quadraticCurveTo(0, my - R * 0.03, R * 0.12, my + R * 0.01)
        g.stroke()
      } else if (ph !== 'sleep') {
        const big = emo === 'радость' || emo === 'гордость'
        g.beginPath()
        g.arc(0, my - R * (big ? 0.1 : 0.06), R * (big ? 0.2 : 0.14), 0.18 * Math.PI, 0.82 * Math.PI)
        g.stroke()
      } else {
        g.beginPath()
        g.ellipse(0, my, R * 0.04, R * 0.03, 0, 0, Math.PI * 2)
        g.fill()
      }
      g.restore()

      // сон: «z» улетают вверх
      if (ph === 'sleep') {
        if (now > nextZ) {
          nextZ = now + 1400
          zs.push({ x: cx + R * 0.6, y: cy - R * 0.6, a: 1 })
        }
      }
      for (const z of zs) {
        z.y -= 0.5
        z.x += Math.sin(z.y / 18) * 0.4
        z.a -= 0.006
        g.fillStyle = `rgba(255,170,90,${Math.max(0, z.a)})`
        g.font = `${Math.round(R * 0.22 * (1.4 - z.a * 0.6))}px system-ui`
        g.fillText('z', z.x, z.y)
      }
      while (zs.length && zs[0].a <= 0) zs.shift()
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
    }
  }, [])

  return <canvas ref={ref} className="shef-blob" aria-hidden />
}
