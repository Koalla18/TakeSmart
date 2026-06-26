import { useEffect, useState } from 'react'

// Лёгкая система тостов без контекста/провайдера: toast() можно звать из любого
// обработчика и под-компонента (это обычная функция модуля), а <ToastHost/>
// рендерится один раз и показывает стек. Замена нативных alert() в админке.

type ToastType = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let items: ToastItem[] = []
let listeners: Array<(items: ToastItem[]) => void> = []
let seq = 0

function emit() {
  for (const l of listeners) l(items)
}

export function toast(message: string, type: ToastType = 'info', ttl = 4000): void {
  const id = ++seq
  items = [...items, { id, message, type }]
  emit()
  window.setTimeout(() => {
    items = items.filter(i => i.id !== id)
    emit()
  }, ttl)
}

const STYLES: Record<ToastType, { ring: string; icon: string }> = {
  success: { ring: 'border-green-500/40', icon: '✅' },
  error: { ring: 'border-red-500/40', icon: '⚠️' },
  info: { ring: 'border-white/15', icon: 'ℹ️' },
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)

  useEffect(() => {
    const l = (next: ToastItem[]) => setList([...next])
    listeners.push(l)
    return () => {
      listeners = listeners.filter(x => x !== l)
    }
  }, [])

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
            onClick={() => { items = items.filter(i => i.id !== t.id); emit() }}
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
