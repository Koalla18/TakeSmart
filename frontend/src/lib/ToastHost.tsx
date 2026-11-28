import { useEffect, useState } from 'react'
import { getSnapshot, subscribe, dismissToast, type ToastType, type ToastItem } from './toast'

const STYLES: Record<ToastType, { ring: string; icon: string }> = {
  success: { ring: 'border-green-500/40', icon: '✅' },
  error: { ring: 'border-red-500/40', icon: '⚠️' },
  info: { ring: 'border-white/15', icon: 'ℹ️' },
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(getSnapshot)

  useEffect(() => subscribe(next => setList([...next])), [])

  if (list.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
      {list.map(t => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${STYLES[t.type].ring} bg-slate-900/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur transition-all`}
        >
          <span className="mt-0.5 flex-shrink-0">{STYLES[t.type].icon}</span>
          <span className="whitespace-pre-line break-words">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="ml-auto flex-shrink-0 text-white/40 hover:text-white"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
