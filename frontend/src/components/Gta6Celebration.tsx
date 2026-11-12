import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Момент выхода GTA VI на странице /gta6: залп блёсток в цветах раздела и надпись
// «уже вышла» поверх страницы. Показывается, когда таймер дошёл до нуля у
// открытой страницы, и один раз — при первом заходе после релиза. Сам исчезает,
// клики не перехватывает; при настройке «уменьшить движение» блёсток нет.
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = ['#ffb0c4', '#ff8fb1', '#c9a7f5', '#ffd27a', '#ffffff', '#ffc3a0', '#8fd3ff']
const DURATION_MS = 5200

interface Piece {
  x: number; y: number; vx: number; vy: number
  size: number; color: string; rot: number; vrot: number
  /** 0 — бумажка, 1 — кружок, 2 — искра-звёздочка */
  kind: 0 | 1 | 2
  phase: number
}

function makePieces(w: number, h: number): Piece[] {
  const count = Math.min(220, Math.round(w / 6))
  const pieces: Piece[] = []
  for (let i = 0; i < count; i++) {
    // Два залпа из нижних углов навстречу друг другу + немного «дождя» сверху
    const side = i % 3
    const fromLeft = side === 0
    const rain = side === 2
    const angle = rain ? Math.PI / 2 : (fromLeft ? -Math.PI / 3 : (-2 * Math.PI) / 3) + (Math.random() - 0.5) * 0.9
    // Сила залпа растёт с высотой экрана — блёстки долетают до верхней трети и на телефоне, и на мониторе
    const speed = rain ? 1 + Math.random() * 2 : h * (0.016 + Math.random() * 0.016)
    pieces.push({
      x: rain ? Math.random() * w : fromLeft ? -10 : w + 10,
      y: rain ? -20 - Math.random() * h * 0.5 : h * (0.75 + Math.random() * 0.2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 7,
      color: COLORS[i % COLORS.length],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.35,
      kind: (i % 5 === 0 ? 2 : i % 2) as 0 | 1 | 2,
      phase: Math.random() * Math.PI * 2,
    })
  }
  return pieces
}

function drawStar(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? r : r * 0.28
    const a = (i * Math.PI) / 4
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius)
  }
  ctx.closePath()
  ctx.fill()
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = window.innerWidth, h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    const pieces = makePieces(w, h)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = now - start
      ctx.clearRect(0, 0, w, h)
      // В последнюю секунду всё плавно гаснет
      const fade = Math.min(1, Math.max(0, (DURATION_MS - t) / 1000))
      for (const p of pieces) {
        p.vy += 0.22            // гравитация
        p.vx *= 0.985           // сопротивление воздуха
        p.vy *= 0.985
        p.x += p.vx + Math.sin(t / 300 + p.phase) * 0.6
        p.y += p.vy
        p.rot += p.vrot
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        if (p.kind === 2) {
          // Искры мерцают
          ctx.globalAlpha = fade * (0.55 + 0.45 * Math.sin(t / 90 + p.phase))
          drawStar(ctx, p.size * 0.9)
        } else if (p.kind === 1) {
          ctx.globalAlpha = fade
          ctx.beginPath()
          ctx.arc(0, 0, p.size * 0.38, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // Бумажка «переворачивается» — сжимается по одной оси
          ctx.globalAlpha = fade
          ctx.scale(1, Math.cos(t / 140 + p.phase))
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        }
        ctx.restore()
      }
      if (t < DURATION_MS) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <canvas ref={ref} className="fixed inset-0 z-[80] h-full w-full" aria-hidden="true" />
}

export function Gta6Celebration({ gift, onDone }: { gift: boolean; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, DURATION_MS + 200)
    return () => window.clearTimeout(id)
  }, [onDone])
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" data-gta6-celebration>
      <Confetti />
      <div className="gta-release-card absolute inset-0 flex items-center justify-center p-6" role="status">
        <div className="max-w-xl rounded-3xl bg-[#11111d]/90 px-8 py-8 text-center text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/15 backdrop-blur sm:px-12 sm:py-10">
          <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#ffb0c4] sm:text-xs">Дождались</div>
          <div className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">GTA VI уже вышла</div>
          <div className="mt-4 text-base text-white/80 sm:text-lg">
            {gift ? 'Берите PlayStation 5 — игру дарим и отдаём сразу.' : 'Берите PlayStation 5 и играйте уже сегодня.'}
          </div>
        </div>
      </div>
    </div>
  )
}
