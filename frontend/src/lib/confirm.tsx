import { useEffect, useState } from 'react'

// Промис-модалка подтверждения (замена нативного confirm()): вызывается из любого
// обработчика как `if (await confirmDialog({...})) { ... }`. <ConfirmHost/> рендерится
// один раз (в AdminPage) и показывает диалог. Тёмная тема — под админку.

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

let current: ConfirmState | null = null
let listeners: Array<(s: ConfirmState | null) => void> = []
let seq = 0

function emit() {
  for (const l of listeners) l(current)
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts
  return new Promise<boolean>(resolve => {
    current = { id: ++seq, ...options, resolve }
    emit()
  })
}

function close(ok: boolean) {
  if (!current) return
  current.resolve(ok)
  current = null
  emit()
}

export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState | null>(current)

  useEffect(() => {
    const l = (s: ConfirmState | null) => setState(s ? { ...s } : null)
    listeners.push(l)
    return () => { listeners = listeners.filter(x => x !== l) }
  }, [])

  // Esc — отмена (намеренно НЕ вешаем Enter, чтобы не подтвердить удаление случайно)
  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  if (!state) return null
  const danger = state.danger !== false // по умолчанию опасное (красная кнопка)

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => close(false)} />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-2xl bg-slate-800 p-6 shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg ${
              danger ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
            }`}
            aria-hidden="true"
          >
            {danger ? '⚠️' : '❓'}
          </span>
          <div className="min-w-0">
            {state.title && <h3 className="text-base font-bold text-white">{state.title}</h3>}
            <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-300">
              {state.message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            autoFocus
            onClick={() => close(false)}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            {state.cancelLabel || 'Отмена'}
          </button>
          <button
            onClick={() => close(true)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-yellow-400 text-gray-900 hover:bg-yellow-300'
            }`}
          >
            {state.confirmLabel || 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  )
}
