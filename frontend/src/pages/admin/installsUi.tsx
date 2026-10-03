// Общие кирпичики раздела «Приложения на iPhone»: поля, карточки, окно, плитка приложения, QR.
import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { resolveApp } from '../../lib/appCatalog'
import { AdminIcon } from './AdminIcons'
import { copyText } from './installsApi'

export const INPUT = 'w-full rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[15px] text-white placeholder:text-slate-600 focus:border-yellow-400/60 focus:bg-white/10 focus:outline-none'
export const BTN_ROW = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20 disabled:opacity-50'
export const CARD = 'rounded-2xl border border-white/10 bg-white/[0.03] p-5'
export const LABEL = 'text-xs font-semibold uppercase tracking-wider text-slate-400'

export function Badge({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const m = map[value] || { label: value, cls: 'bg-white/10 text-slate-300' }
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

export function Cmd({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/40 p-2 pl-3 font-mono text-[12px] leading-relaxed text-yellow-100">
      <span className="min-w-0 flex-1 break-all">{text}</span>
      <button type="button" onClick={() => copyText(text, 'Скопировано')} className={`${BTN_ROW} shrink-0 font-sans`}>Скопировать</button>
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10 sm:rounded-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"><AdminIcon name="x" className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function AppIcon({ app, size = 44 }: { app: ReturnType<typeof resolveApp>; size?: number }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (app.icon && !broken) return <img src={app.icon} alt="" width={size} height={size} style={style} className="shrink-0 bg-white/5 object-cover" onError={() => setBroken(true)} />
  return (
    <span aria-hidden="true" style={{ ...style, background: `hsl(${app.hue} 45% 28%)`, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center font-bold text-white/90">
      {app.letter}
    </span>
  )
}

export function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 6h4" /><path d="M11 18h2" />
    </svg>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean; testId?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} data-testid={testId} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-yellow-400' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <span className="min-w-0 text-sm"><span className="text-white">{label}</span>{hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}</span>
    </label>
  )
}

/** QR-код ссылки: чёрные модули на белом, чтобы камера iPhone читала с любого экрана. */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { d, n }
  }, [value])
  const margin = 2
  return (
    <svg data-qr={value} width={size} height={size} viewBox={`${-margin} ${-margin} ${path.n + margin * 2} ${path.n + margin * 2}`} role="img" aria-label="QR-код ссылки на заказ" shapeRendering="crispEdges" className="shrink-0 rounded-xl bg-white">
      <rect x={-margin} y={-margin} width={path.n + margin * 2} height={path.n + margin * 2} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  )
}
