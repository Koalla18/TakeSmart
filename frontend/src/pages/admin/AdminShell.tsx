/**
 * Каркас админки v2: боковая навигация по группам, один раздел на экране,
 * единая шапка раздела (надзаголовок группы, название, описание, действия).
 *
 * Бизнес-логика разделов сюда не заходит — каркас получает только активный
 * раздел, счётчики для бейджей и колбэки. Любой раздел можно вернуть в старый
 * вид простой заменой обёртки, поэтому содержимое вкладок не трогалось.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AdminIcon } from './AdminIcons'
import { ADMIN_NAV, type AdminSection } from './adminNav'

const HOTKEY_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

// ── Единые классы кнопок для шапок разделов ──────────────────────────────────
export const BTN_PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-yellow-400/10 transition hover:bg-yellow-300 disabled:opacity-50'
export const BTN_SECONDARY = 'inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.09] hover:text-white disabled:opacity-50'

export interface AdminShellProps {
  /** Пункт меню, который подсвечен */
  active: AdminSection
  onNavigate: (section: AdminSection) => void
  /** Серые счётчики у пунктов меню (сколько сущностей) */
  counts?: Partial<Record<AdminSection, number>>
  /** Жёлтые бейджи «требует реакции» (например, новые заказы) */
  attention?: Partial<Record<AdminSection, number>>
  title: string
  eyebrow?: string
  description?: ReactNode
  actions?: ReactNode
  onOpenSearch: () => void
  onLogout: () => void
  children: ReactNode
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-400 text-slate-950 shadow-lg shadow-yellow-400/20">
        <AdminIcon name="zap" className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold leading-tight text-white">Take Smart</div>
        <div className="text-[11px] text-slate-500">Панель управления</div>
      </div>
    </div>
  )
}

interface NavProps {
  active: AdminSection
  counts: Partial<Record<AdminSection, number>>
  attention: Partial<Record<AdminSection, number>>
  onNavigate: (section: AdminSection) => void
  onOpenSearch: () => void
  onLogout: () => void
}

function SidebarContent({ active, counts, attention, onNavigate, onOpenSearch, onLogout }: NavProps) {
  return (
    <div className="flex h-full flex-col">
      <Brand />

      <button
        type="button"
        onClick={onOpenSearch}
        className="mt-5 flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-slate-400 transition hover:border-white/10 hover:bg-white/[0.07] hover:text-slate-200"
      >
        <AdminIcon name="search" className="h-4 w-4" />
        <span className="flex-1 text-left">Поиск</span>
        <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500">{HOTKEY_LABEL}</kbd>
      </button>

      <nav aria-label="Разделы админки" className="mt-3 flex-1">
        {ADMIN_NAV.map((group, gi) => (
          <div key={group.label ?? `g${gi}`}>
            {group.label && (
              <div className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">{group.label}</div>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const isActive = active === item.id
                const count = counts[item.id]
                const alert = attention[item.id]
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                    }`}
                  >
                    <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-yellow-400 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                    <AdminIcon name={item.icon} className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-yellow-300' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {alert ? (
                      <span className="rounded-full bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-950">{alert}</span>
                    ) : count !== undefined ? (
                      <span className={`text-[11px] tabular-nums ${isActive ? 'text-slate-300' : 'text-slate-600 group-hover:text-slate-400'}`}>{count}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-6 space-y-0.5 border-t border-white/[0.06] pt-3">
        <a href="/" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100">
          <AdminIcon name="external" className="h-[18px] w-[18px] text-slate-500" />
          <span className="flex-1">Открыть сайт</span>
        </a>
        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100">
          <AdminIcon name="logout" className="h-[18px] w-[18px] text-slate-500" />
          <span className="flex-1 text-left">Выйти</span>
        </button>
      </div>
    </div>
  )
}

export function AdminShell({
  active, onNavigate, counts = {}, attention = {}, title, eyebrow, description, actions, onOpenSearch, onLogout, children,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Смена раздела закрывает мобильное меню; Escape — тоже
  useEffect(() => { setDrawerOpen(false) }, [active])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [drawerOpen])

  const navProps: NavProps = {
    active, counts, attention, onOpenSearch, onLogout,
    onNavigate: section => { setDrawerOpen(false); onNavigate(section) },
  }

  return (
    <div className="min-h-screen bg-[#0a0d13] text-slate-200 antialiased">
      {/* Боковая панель — только на широких экранах */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-white/[0.06] bg-[#0d1117] p-4 lg:flex">
        <SidebarContent {...navProps} />
      </aside>

      {/* Мобильная шапка */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0d13]/90 px-3 py-2.5 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Открыть меню" className="rounded-xl p-2 text-slate-300 hover:bg-white/[0.06]">
          <AdminIcon name="menu" className="h-5 w-5" />
        </button>
        <div className="flex-1"><Brand /></div>
        <button type="button" onClick={onOpenSearch} aria-label="Поиск" className="rounded-xl p-2 text-slate-300 hover:bg-white/[0.06]">
          <AdminIcon name="search" className="h-5 w-5" />
        </button>
      </div>

      {/* Мобильное выезжающее меню */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-white/[0.06] bg-[#0d1117] p-4 shadow-2xl">
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Закрыть меню" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-white">
              <AdminIcon name="x" className="h-5 w-5" />
            </button>
            <SidebarContent {...navProps} />
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-yellow-400/80">{eyebrow}</div>}
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">{title}</h1>
              {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

/** Скелет на время первой загрузки данных — повторяет геометрию каркаса, чтобы не прыгало */
export function AdminShellSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0d13]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/[0.06] bg-[#0d1117] p-4 lg:block">
        <div className="flex items-center gap-3 px-2"><div className="h-9 w-9 animate-pulse rounded-xl bg-white/10" /><div className="h-4 w-24 animate-pulse rounded bg-white/10" /></div>
        <div className="mt-5 h-9 animate-pulse rounded-xl bg-white/[0.05]" />
        <div className="mt-6 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
      </aside>
      <div className="sticky top-0 border-b border-white/[0.06] bg-[#0a0d13] px-3 py-3 lg:hidden"><div className="h-6 w-32 animate-pulse rounded bg-white/10" /></div>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-8 w-48 animate-pulse rounded-lg bg-white/10" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          <div className="mt-6 space-y-2 rounded-2xl border border-white/[0.06] p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>
        </div>
      </main>
    </div>
  )
}

// ── Сегменты внутри раздела (например, вкладки «Категории») ───────────────────
export interface SegmentItem<T extends string> { id: T; label: string; count?: number }

export function SegmentedTabs<T extends string>({ items, value, onChange }: { items: SegmentItem<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.03] p-1">
      {items.map(item => {
        const isActive = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              isActive ? 'bg-white/[0.1] text-white shadow-sm' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
            }`}
          >
            {item.label}
            {item.count !== undefined && <span className={`text-[11px] tabular-nums ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
