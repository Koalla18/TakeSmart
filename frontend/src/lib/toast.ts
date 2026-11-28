export type ToastType = 'success' | 'error' | 'info'
export interface ToastItem {
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

export function getSnapshot() { return items }

export function subscribe(listener: (next: ToastItem[]) => void) {
  listeners.push(listener)
  return () => { listeners = listeners.filter(entry => entry !== listener) }
}

export function dismissToast(id: number) {
  items = items.filter(item => item.id !== id)
  emit()
}
