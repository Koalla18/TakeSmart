/**
 * Палитра поиска (⌘K): один вход ко всему, что уже загружено в админке —
 * разделы, заказы, товары, категории, бренды. Ничего не запрашивает у сервера:
 * страница и так держит списки в памяти, поэтому поиск мгновенный.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdminIcon, type AdminIconName } from './AdminIcons'

export interface PaletteItem {
  id: string
  group: string
  title: string
  subtitle?: string
  icon?: AdminIconName
  onSelect: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Поставщик результатов: при пустом запросе возвращает разделы и подсказки */
  search: (query: string) => PaletteItem[]
}

export function CommandPalette({ open, onClose, search }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => (open ? search(query) : []), [open, query, search])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 10)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.clearTimeout(t); document.body.style.overflow = prev }
  }, [open])

  useEffect(() => { setCursor(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, items])

  if (!open) return null

  const select = (item: PaletteItem) => { onClose(); item.onSelect() }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(items.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const item = items[cursor]; if (item) select(item) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  // Группируем подряд идущие элементы одной группы под общим заголовком
  const rows: { header?: string; item?: PaletteItem; index?: number }[] = []
  let lastGroup: string | null = null
  items.forEach((item, index) => {
    if (item.group !== lastGroup) { rows.push({ header: item.group }); lastGroup = item.group }
    rows.push({ item, index })
  })

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Поиск по админке">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0f141b] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
          <AdminIcon name="search" className="h-5 w-5 shrink-0 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Заказ, товар, категория, бренд или раздел…"
            className="h-14 w-full bg-transparent text-[15px] text-white placeholder-slate-500 outline-none"
          />
          <kbd className="hidden rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:block">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-500">Ничего не нашлось. Попробуйте номер заказа, телефон клиента или название товара.</div>
          ) : rows.map((row, i) => row.header !== undefined ? (
            <div key={`h-${row.header}-${i}`} className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 first:pt-1">{row.header}</div>
          ) : (
            <button
              key={row.item!.id}
              type="button"
              data-index={row.index}
              onMouseEnter={() => setCursor(row.index!)}
              onClick={() => select(row.item!)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${row.index === cursor ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${row.index === cursor ? 'bg-yellow-400/15 text-yellow-300' : 'bg-white/[0.05] text-slate-400'}`}>
                <AdminIcon name={row.item!.icon ?? 'arrowRight'} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{row.item!.title}</span>
                {row.item!.subtitle && <span className="block truncate text-xs text-slate-500">{row.item!.subtitle}</span>}
              </span>
              {row.index === cursor && <span className="hidden text-[11px] text-slate-500 sm:block">Enter ↵</span>}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[11px] text-slate-600">
          <span><kbd className="font-sans">↑↓</kbd> перемещение</span>
          <span><kbd className="font-sans">Enter</kbd> открыть</span>
          <span><kbd className="font-sans">Esc</kbd> закрыть</span>
        </div>
      </div>
    </div>
  )
}
