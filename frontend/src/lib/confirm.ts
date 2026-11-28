interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmState extends ConfirmOptions {
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

export function close(ok: boolean) {
  if (!current) return
  current.resolve(ok)
  current = null
  emit()
}

export function getSnapshot() { return current }

export function subscribe(listener: (s: ConfirmState | null) => void) {
  listeners.push(listener)
  return () => { listeners = listeners.filter(entry => entry !== listener) }
}
