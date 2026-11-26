// Голограмма-пирамида (призрак Пеппера): 4 копии Бурмалдеца вокруг центра экрана.
// На экран ставится прозрачная пирамидка (узким концом вниз, в центр) — и Бурмалдец «висит» внутри в воздухе.
// Каждая копия «смотрит» макушкой от центра и отражена зеркально: пластик переворачивает её обратно.
import { useEffect, useRef } from 'react'
import type { Emotion } from './brain'
import Holo, { type Phase } from './Holo'

export default function Pyramid({ phase, emotion, poke }: { phase: Phase; emotion: Emotion; poke?: number }) {
  const src = useRef<HTMLCanvasElement | null>(null)
  const out = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = out.current!
    const g = c.getContext('2d')!
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = c.clientWidth
      const H = c.clientHeight
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = '#000'
      g.fillRect(0, 0, W, H)
      const s = src.current
      if (!s || !s.width) return
      const S = Math.min(W, H)
      const cell = S * 0.4 // размер одной копии
      const off = S * 0.27 // от центра до копии
      for (let k = 0; k < 4; k++) {
        g.save()
        g.translate(W / 2, H / 2)
        g.rotate((k * Math.PI) / 2)
        g.translate(0, -off)
        g.scale(-1, 1)
        g.drawImage(s, -cell / 2, -cell / 2, cell, cell)
        g.restore()
      }
      // метка в центре — сюда ставится узкий конец пирамидки (1 см)
      g.strokeStyle = 'rgba(110,230,255,0.18)'
      g.lineWidth = 1
      const m = 19
      g.strokeRect(W / 2 - m, H / 2 - m, m * 2, m * 2)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="pyramid">
      <div className="pyramid-src" aria-hidden>
        <Holo phase={phase} emotion={emotion} poke={poke} bare onCanvas={(cv) => (src.current = cv)} />
      </div>
      <canvas ref={out} className="pyramid-out" aria-label="Голограмма Бурмалдеца для пирамиды" />
    </div>
  )
}
