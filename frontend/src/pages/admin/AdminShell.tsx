/**
 * Каркас админки v2 «Пульт».
 *
 * Два вида на одних и тех же данных: «док» — без бокового меню, разделы в
 * плавающей панели внизу (как док в macOS), и «панель» — классическое боковое
 * меню. Вид переключается кнопкой в шапке и запоминается в браузере.
 * Общее для обоих: живой фон-аврора, стекло, крупный заголовок раздела со
 * строкой статуса (с пульсом, когда прямо сейчас есть что делать),
 * появление содержимого раздела при переключении.
 *
 * Бизнес-логика разделов сюда не заходит — каркас получает только активный
 * раздел, счётчики для бейджей и колбэки; содержимое вкладок не трогалось.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { AdminIcon } from './AdminIcons'
import { ADMIN_NAV, type AdminSection } from './adminNav'

export type AdminLayoutMode = 'dock' | 'sidebar'
const LAYOUT_KEY = 'takesmart_admin_layout'

export function readLayoutMode(): AdminLayoutMode {
  try { return localStorage.getItem(LAYOUT_KEY) === 'sidebar' ? 'sidebar' : 'dock' } catch { return 'dock' }
}
export function storeLayoutMode(mode: AdminLayoutMode): void {
  try { localStorage.setItem(LAYOUT_KEY, mode) } catch { /* приватный режим — просто не запомним */ }
}

const HOTKEY_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

// ── Единые классы кнопок для шапок разделов ──────────────────────────────────
export const BTN_PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_10px_30px_-10px_rgba(250,204,21,0.7)] transition hover:bg-yellow-300 hover:shadow-[0_12px_34px_-10px_rgba(250,204,21,0.9)] disabled:opacity-50'
export const BTN_SECONDARY = 'inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 backdrop-blur transition hover:bg-white/[0.09] hover:text-white disabled:opacity-50'

export interface AdminShellProps {
  /** Пункт меню, который подсвечен */
  active: AdminSection
  onNavigate: (section: AdminSection) => void
  /** Серые счётчики у пунктов бокового меню */
  counts?: Partial<Record<AdminSection, number>>
  /** Бейджи «требует реакции» (например, новые заказы) */
  attention?: Partial<Record<AdminSection, number>>
  title: string
  eyebrow?: string
  description?: ReactNode
  /** Пульсирующая точка перед описанием: прямо сейчас есть что делать */
  live?: boolean
  actions?: ReactNode
  layout: AdminLayoutMode
  onToggleLayout: () => void
  onOpenSearch: () => void
  onLogout: () => void
  children: ReactNode
}

function Aurora() {
  return <div className="admin-aurora" aria-hidden="true"><i /><i /><i /></div>
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="deck-bolt flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-400 text-slate-950">
        <AdminIcon name="bolt" className="h-[18px] w-[18px]" />
      </span>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-bold text-white">Take Smart</div>
          <div className="text-[11px] text-slate-500">Панель управления</div>
        </div>
      )}
    </div>
  )
}

function IconButton({ icon, label, onClick, href }: { icon: Parameters<typeof AdminIcon>[0]['name']; label: string; onClick?: () => void; href?: string }) {
  const cls = 'flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[0.07] hover:text-white'
  if (href) return <a href={href} title={label} aria-label={label} className={cls}><AdminIcon name={icon} className="h-[18px] w-[18px]" /></a>
  return <button type="button" onClick={onClick} title={label} aria-label={label} className={cls}><AdminIcon name={icon} className="h-[18px] w-[18px]" /></button>
}

// ── Док ───────────────────────────────────────────────────────────────────────
function Dock({ active, attention, onNavigate }: { active: AdminSection; attention: Partial<Record<AdminSection, number>>; onNavigate: (s: AdminSection) => void }) {
  return (
    <nav aria-label="Разделы админки" className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-3 sm:pb-5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      <div className="flex items-end rounded-[26px] border border-white/10 bg-[#0d1117]/85 p-1.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-2">
        {ADMIN_NAV.map((group, gi) => (
          <Fragment key={group.label ?? `g${gi}`}>
            {gi > 0 && <span aria-hidden="true" className="mx-0.5 mb-3 h-7 w-px self-end bg-white/10 sm:mx-1.5 sm:mb-6" />}
            {group.items.map(item => {
              const isActive = active === item.id
              const alert = attention[item.id]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className="group relative flex w-10 flex-col items-center gap-1 pb-0.5 pt-0.5 sm:w-[66px]"
                >
                  <span className={`relative flex h-9 w-9 items-center justify-center rounded-[13px] transition-all duration-200 group-hover:-translate-y-1 sm:h-11 sm:w-11 sm:rounded-[15px] ${
                    isActive
                      ? 'bg-yellow-400 text-slate-950 shadow-[0_10px_26px_-6px_rgba(250,204,21,0.75)]'
                      : 'bg-white/[0.05] text-slate-300 group-hover:bg-white/[0.12] group-hover:text-white'
                  }`}>
                    <AdminIcon name={item.icon} className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                    {alert ? (
                      <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-[#0d1117]">{alert}</span>
                    ) : null}
                  </span>
                  <span className={`hidden text-[10px] font-medium leading-none sm:block ${isActive ? 'text-yellow-300' : 'text-slate-500 group-hover:text-slate-300'}`}>{item.label}</span>
                  {/* На телефоне подписи нет — подсказка при удержании */}
                  <span className="pointer-events-none absolute -top-8 whitespace-nowrap rounded-lg bg-slate-900/95 px-2 py-1 text-[11px] text-white opacity-0 shadow-lg transition group-hover:opacity-100 sm:hidden">{item.label}</span>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
    </nav>
  )
}

// ── Боковое меню (вид «панель») ───────────────────────────────────────────────
interface SidebarProps {
  active: AdminSection
  counts: Partial<Record<AdminSection, number>>
  attention: Partial<Record<AdminSection, number>>
  onNavigate: (section: AdminSection) => void
  onOpenSearch: () => void
  onLogout: () => void
  onToggleLayout: () => void
}

function SidebarContent({ active, counts, attention, onNavigate, onOpenSearch, onLogout, onToggleLayout }: SidebarProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-2"><BrandMark /></div>
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
            {group.label && <div className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">{group.label}</div>}
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
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'}`}
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
        <button type="button" onClick={onToggleLayout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-100">
          <AdminIcon name="dock" className="h-[18px] w-[18px] text-slate-500" />
          <span className="flex-1 text-left">Вид: док внизу</span>
        </button>
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

// ── Шапка раздела ─────────────────────────────────────────────────────────────
function PageHero({ title, eyebrow, description, live, actions }: Pick<AdminShellProps, 'title' | 'eyebrow' | 'description' | 'live' | 'actions'>) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-yellow-400/80">{eyebrow}</div>}
        <h1 className="text-[32px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[40px]">{title}</h1>
        {description && (
          <div className="mt-3 flex items-center gap-2.5 text-sm text-slate-400">
            {live && <span className="live-dot shrink-0 bg-yellow-400 text-yellow-400" aria-hidden="true" />}
            <span>{description}</span>
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function AdminShell({
  active, onNavigate, counts = {}, attention = {}, title, eyebrow, description, live = false, actions,
  layout, onToggleLayout, onOpenSearch, onLogout, children,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [active, layout])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [drawerOpen])

  const sidebarProps: SidebarProps = {
    active, counts, attention, onOpenSearch, onLogout, onToggleLayout,
    onNavigate: section => { setDrawerOpen(false); onNavigate(section) },
  }
  const crumb = eyebrow ? `${eyebrow} · ${title}` : title
  const isDock = layout === 'dock'

  return (
    <div className="relative min-h-screen bg-[#07090d] text-slate-200 antialiased">
      <Aurora />

      {/* Боковое меню (вид «панель», только широкие экраны) */}
      {!isDock && (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-white/[0.06] bg-[#0b0f16]/80 p-4 backdrop-blur-xl lg:flex">
          <SidebarContent {...sidebarProps} />
        </aside>
      )}

      {/* Верхняя полоса: в доке — всегда, в панели — только на узких экранах */}
      <header className={`sticky top-0 z-30 border-b border-white/[0.06] bg-[#07090d]/70 backdrop-blur-xl ${isDock ? '' : 'lg:hidden'}`}>
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:px-6 lg:px-8">
          {!isDock && (
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Открыть меню" className="rounded-xl p-2 text-slate-300 hover:bg-white/[0.06] lg:hidden">
              <AdminIcon name="menu" className="h-5 w-5" />
            </button>
          )}
          <BrandMark compact />
          <span className="hidden min-w-0 items-baseline gap-2 sm:flex">
            <span className="text-sm font-bold text-white">Take Smart</span>
            <span className="text-slate-600">/</span>
            <span className="truncate text-sm text-slate-400">{crumb}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-400 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              <AdminIcon name="search" className="h-4 w-4" />
              <span className="hidden sm:inline">Поиск</span>
              <kbd className="hidden rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 sm:inline">{HOTKEY_LABEL}</kbd>
            </button>
            <IconButton icon="external" label="Открыть сайт" href="/" />
            <IconButton icon={isDock ? 'sidebar' : 'dock'} label={isDock ? 'Вид: боковое меню' : 'Вид: док внизу'} onClick={onToggleLayout} />
            <IconButton icon="logout" label="Выйти" onClick={onLogout} />
          </div>
        </div>
      </header>

      {/* Мобильное выезжающее меню (вид «панель») */}
      {!isDock && drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-white/[0.06] bg-[#0d1117] p-4 shadow-2xl">
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Закрыть меню" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-white">
              <AdminIcon name="x" className="h-5 w-5" />
            </button>
            <SidebarContent {...sidebarProps} />
          </div>
        </div>
      )}

      <main className={`relative z-[1] ${isDock ? 'pb-32' : 'pb-16 lg:pl-64'}`}>
        <div className="mx-auto w-full max-w-7xl px-4 pt-7 sm:px-6 lg:px-8 lg:pt-9">
          <PageHero title={title} eyebrow={eyebrow} description={description} live={live} actions={actions} />
          {/* key=active: содержимое нового раздела монтируется заново и «приезжает» */}
          <div key={active} className="deck-enter">{children}</div>
        </div>
      </main>

      {isDock && <Dock active={active} attention={attention} onNavigate={onNavigate} />}
    </div>
  )
}

/** Скелет на время первой загрузки — повторяет геометрию каркаса, чтобы не прыгало */
export function AdminShellSkeleton() {
  return (
    <div className="relative min-h-screen bg-[#07090d]">
      <Aurora />
      <div className="sticky top-0 border-b border-white/[0.06] bg-[#07090d]/70 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3"><div className="h-9 w-9 animate-pulse rounded-xl bg-yellow-400/40" /><div className="h-4 w-32 animate-pulse rounded bg-white/10" /></div>
      </div>
      <main className="relative z-[1]">
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
          <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-9 w-56 animate-pulse rounded-lg bg-white/10" />
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          <div className="mt-6 space-y-2 rounded-2xl border border-white/[0.06] p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-5 flex justify-center"><div className="h-16 w-[520px] max-w-[92vw] animate-pulse rounded-[26px] bg-white/[0.05]" /></div>
    </div>
  )
}

// ── Сегменты внутри раздела (например, вкладки «Категории») ───────────────────
export interface SegmentItem<T extends string> { id: T; label: string; count?: number }

export function SegmentedTabs<T extends string>({ items, value, onChange }: { items: SegmentItem<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.03] p-1 backdrop-blur">
      {items.map(item => {
        const isActive = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${isActive ? 'bg-white/[0.1] text-white shadow-sm' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'}`}
          >
            {item.label}
            {item.count !== undefined && <span className={`text-[11px] tabular-nums ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
