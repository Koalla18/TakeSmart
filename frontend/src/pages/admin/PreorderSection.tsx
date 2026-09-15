import { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { formatPreorderDate, formatPrice } from '../../data/products'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { pluralRu } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// Раздел «Предзаказ»: один экран, где сотрудник видит все новинки до старта
// продаж и правит по месту цену, дату поступления и подпись для витрины.
// Данные — общий список товаров админки (products), запросы — PATCH карточки
// и POST /products/preorder/bulk для пачек.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreorderProduct {
  id: string
  name: string
  slug: string
  sku: string | null
  brand: string | null
  price: number
  discount_price: number | null
  stock_quantity: number
  main_image_url: string | null
  is_active: boolean
  condition: string
  category_id: string | null
  is_preorder?: boolean
  preorder_note?: string | null
  preorder_expected_at?: string | null
}

interface PreorderCategory { id: string; name: string }
type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>

interface Draft { price?: string; date?: string; note?: string }

const CHIP = 'inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-300 ring-1 ring-inset ring-violet-400/30'
const INPUT = 'w-full rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-sm text-white placeholder:text-slate-600 focus:border-violet-400/60 focus:bg-white/10 focus:outline-none'

function codeOf(name: string): { title: string; code: string | null } {
  const m = name.match(/\(([A-Z][A-Z0-9/-]{2,})\)$/)
  return m ? { title: name.replace(/\s*\([A-Z][A-Z0-9/-]{2,}\)$/, ''), code: m[1] } : { title: name, code: null }
}

function preorderSort<P extends PreorderProduct>(a: P, b: P): number {
  const da = a.preorder_expected_at || ''
  const db = b.preorder_expected_at || ''
  if (da && db && da !== db) return da < db ? -1 : 1
  if (da && !db) return -1
  if (!da && db) return 1
  return a.name.localeCompare(b.name, 'ru')
}

async function readError(res: Response): Promise<string> {
  try {
    const err = await res.json()
    if (typeof err.detail === 'string') return err.detail
    if (Array.isArray(err.detail)) return err.detail.map((e: { msg?: string }) => e.msg).join('; ')
  } catch { /* ignore */ }
  return `Ошибка ${res.status}`
}

export function PreorderSection<P extends PreorderProduct>({
  products, categories, authFetch, imageUrl, onEdit, onRefresh, addOpen, setAddOpen,
}: {
  products: P[]
  categories: PreorderCategory[]
  authFetch: AuthFetch
  imageUrl: (url?: string | null) => string
  onEdit: (p: P) => void
  onRefresh: () => void
  addOpen: boolean
  setAddOpen: (open: boolean) => void
}) {
  const list = useMemo(() => products.filter(p => p.is_preorder).sort(preorderSort), [products])
  const categoryName = (id: string | null) => categories.find(c => c.id === id)?.name || '—'

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  // Товар ушёл из предзаказа (или был удалён) — черновик и выделение больше не нужны
  useEffect(() => {
    const ids = new Set(list.map(p => p.id))
    setSelected(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [list])

  const stats = useMemo(() => {
    const withoutDate = list.filter(p => !p.preorder_expected_at && !(p.preorder_note || '').trim()).length
    const hidden = list.filter(p => !p.is_active).length
    const nearest = list.find(p => p.preorder_expected_at)?.preorder_expected_at || null
    return { total: list.length, withoutDate, hidden, nearest }
  }, [list])

  // ── Правки по месту ──────────────────────────────────────────────────────
  const draftOf = (p: P): Draft => drafts[p.id] ?? {}
  const priceValue = (p: P) => draftOf(p).price ?? String(Number(p.price))
  const dateValue = (p: P) => draftOf(p).date ?? (p.preorder_expected_at || '')
  const noteValue = (p: P) => draftOf(p).note ?? (p.preorder_note || '')
  const setDraft = (id: string, patch: Draft) => setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
  const isDirty = (p: P) => {
    const d = draftOf(p)
    if (d.price !== undefined && Number(d.price) !== Number(p.price)) return true
    if (d.date !== undefined && (d.date || '') !== (p.preorder_expected_at || '')) return true
    if (d.note !== undefined && d.note.trim() !== (p.preorder_note || '').trim()) return true
    return false
  }

  const saveRow = async (p: P) => {
    const d = draftOf(p)
    const body: Record<string, unknown> = {}
    if (d.price !== undefined) {
      const price = Number(String(d.price).replace(/\s/g, '').replace(',', '.'))
      if (!Number.isFinite(price) || price <= 0) { toast('Цена должна быть больше нуля', 'error'); return }
      if (p.discount_price != null && p.discount_price >= price) { toast('Цена со скидкой должна быть меньше основной — поправьте её в карточке', 'error'); return }
      if (price !== Number(p.price)) body.price = price
    }
    if (d.date !== undefined && (d.date || '') !== (p.preorder_expected_at || '')) body.preorder_expected_at = d.date || null
    if (d.note !== undefined && d.note.trim() !== (p.preorder_note || '').trim()) body.preorder_note = d.note.trim() || null
    if (Object.keys(body).length === 0) { setDrafts(prev => { const next = { ...prev }; delete next[p.id]; return next }); return }
    setSavingId(p.id)
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      setDrafts(prev => { const next = { ...prev }; delete next[p.id]; return next })
      toast('Сохранено', 'success')
      onRefresh()
    } catch { toast('Не удалось сохранить', 'error') }
    finally { setSavingId(null) }
  }

  const removeOne = async (p: P) => {
    if (!(await confirmDialog({ title: 'Снять с предзаказа?', message: `«${codeOf(p.name).title}» вернётся к обычным правилам: покупка только при наличии на складе.`, confirmLabel: 'Снять' }))) return
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_preorder: false }),
      })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      toast('Снято с предзаказа', 'success')
      onRefresh()
    } catch { toast('Не удалось снять с предзаказа', 'error') }
  }

  // ── Пачки ────────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelected(prev => (prev.size === list.length ? new Set() : new Set(list.map(p => p.id))))

  const bulk = async (payload: Record<string, unknown>, done: string) => {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await authFetch(`${API_BASE_URL}/api/products/preorder/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [...selected], ...payload }),
      })
      if (!res.ok) { toast(await readError(res), 'error'); return false }
      toast(done, 'success')
      setSelected(new Set())
      setBulkOpen(false)
      onRefresh()
      return true
    } catch { toast('Ошибка запроса', 'error'); return false }
    finally { setBulkBusy(false) }
  }

  const applyBulkTerms = async () => {
    const payload: Record<string, unknown> = { is_preorder: true }
    if (bulkDate) payload.preorder_expected_at = bulkDate
    if (bulkNote.trim()) payload.preorder_note = bulkNote.trim()
    if (!bulkDate && !bulkNote.trim()) { toast('Укажите дату или подпись', 'error'); return }
    if (await bulk(payload, `Обновлено: ${selected.size}`)) { setBulkDate(''); setBulkNote('') }
  }
  const clearBulkTerms = async () => {
    await bulk({ is_preorder: true, preorder_expected_at: null, preorder_note: null }, `Дата и подпись очищены: ${selected.size}`)
  }
  const removeSelected = async () => {
    if (!(await confirmDialog({ title: `Снять с предзаказа ${selected.size} ${pluralRu(selected.size, 'товар', 'товара', 'товаров')}?`, message: 'Товары вернутся к обычным правилам продажи.', confirmLabel: 'Снять' }))) return
    await bulk({ is_preorder: false }, 'Снято с предзаказа')
  }

  return (
    <>
      {/* Сводка */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="В предзаказе" value={String(stats.total)} tone="violet" icon="sparkle" />
        <StatCard label="Ближайшее поступление" value={stats.nearest ? formatPreorderDate(stats.nearest) : '—'} icon="clock" />
        <StatCard label="Без даты и подписи" value={String(stats.withoutDate)} tone={stats.withoutDate ? 'amber' : undefined} icon="alert" hint={stats.withoutDate ? 'На сайте подпись «Скоро в продаже»' : undefined} />
        <StatCard label="Скрыто с сайта" value={String(stats.hidden)} tone={stats.hidden ? 'rose' : undefined} icon="eyeOff" />
      </div>

      {list.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300"><AdminIcon name="sparkle" className="h-7 w-7" /></div>
          <h3 className="text-lg font-semibold text-white">Предзаказ пока пуст</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Добавьте новинки — на сайте они получат бейдж «Предзаказ», отдельный блок на главной и страницу /preorder. Покупатель оформит заказ без проверки остатка, а вы увидите пометку в заказах.
          </p>
          <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} mt-6`}><AdminIcon name="plus" className="h-4 w-4" />Добавить товары</button>
        </div>
      ) : (
        <>
          {/* Панель выделения */}
          {selected.size > 0 && (
            <div className="mb-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-sm font-medium text-violet-100">Выбрано: {selected.size}</span>
                <button type="button" onClick={() => setBulkOpen(v => !v)} className={BTN_SECONDARY} aria-expanded={bulkOpen}><AdminIcon name="clock" className="h-4 w-4" />Дата и подпись</button>
                <button type="button" onClick={clearBulkTerms} disabled={bulkBusy} className={BTN_SECONDARY}>Очистить дату и подпись</button>
                <button type="button" onClick={removeSelected} disabled={bulkBusy} className="inline-flex items-center gap-2 rounded-xl bg-rose-500/15 px-4 py-2.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-50"><AdminIcon name="x" className="h-4 w-4" />Снять с предзаказа</button>
                <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-sm text-slate-400 hover:text-white">Сбросить</button>
              </div>
              {bulkOpen && (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-white/10 pt-3">
                  <label className="text-xs text-slate-400">Ожидается
                    <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} className={`${INPUT} mt-1 w-[170px]`} />
                  </label>
                  <label className="min-w-[240px] flex-1 text-xs text-slate-400">Подпись на сайте
                    <input value={bulkNote} onChange={e => setBulkNote(e.target.value.slice(0, 200))} placeholder="Старт продаж 26 сентября" className={`${INPUT} mt-1`} />
                  </label>
                  <button type="button" onClick={applyBulkTerms} disabled={bulkBusy} className={BTN_PRIMARY}>Применить к {selected.size}</button>
                </div>
              )}
            </div>
          )}

          {/* Таблица (десктоп) */}
          <div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] md:block">
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-[130px]" />
                <col className="w-[170px]" />
                <col className="w-[250px] xl:w-[300px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                  <th className="p-3"><input type="checkbox" aria-label="Выбрать все" checked={selected.size === list.length && list.length > 0} onChange={toggleAll} className="h-4 w-4 rounded accent-violet-500" /></th>
                  <th className="p-3">Товар</th>
                  <th className="p-3">Цена, ₽</th>
                  <th className="p-3">Ожидается</th>
                  <th className="p-3">Подпись на сайте</th>
                  <th className="p-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {list.map(p => {
                  const { title, code } = codeOf(p.name)
                  const img = imageUrl(p.main_image_url)
                  const dirty = isDirty(p)
                  const saving = savingId === p.id
                  return (
                    <tr key={p.id} className={`border-b border-white/5 align-top transition-colors hover:bg-white/[0.04] ${selected.has(p.id) ? 'bg-white/[0.03]' : ''}`} data-preorder-row={p.id}>
                      <td className="p-3 pt-4"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="h-4 w-4 rounded accent-violet-500" aria-label={`Выбрать ${title}`} /></td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          {img ? <img src={img} alt="" className="h-11 w-11 rounded-xl bg-white/10 object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-slate-500"><AdminIcon name="box" className="h-5 w-5" /></div>}
                          <div className="min-w-0">
                            <div className="flex items-start gap-2 font-semibold leading-snug text-white">
                              <span className="line-clamp-2 break-words" title={title}>{title}</span>
                              {code && <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-400">{code}</span>}
                              {!p.is_active && <span className="text-xs text-rose-400">(скрыт)</span>}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">{[p.brand, categoryName(p.category_id), p.stock_quantity > 0 ? `${p.stock_quantity} шт. на складе` : 'нет на складе'].filter(Boolean).join(' · ')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <input
                          value={priceValue(p)}
                          onChange={e => setDraft(p.id, { price: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveRow(p) }}
                          inputMode="decimal"
                          aria-label={`Цена: ${title}`}
                          className={`${INPUT} font-semibold text-yellow-300`}
                        />
                        {p.discount_price != null && <div className="mt-1 text-[11px] text-green-400">{formatPrice(p.discount_price)} со скидкой</div>}
                      </td>
                      <td className="p-3">
                        <input type="date" value={dateValue(p)} onChange={e => setDraft(p.id, { date: e.target.value })} aria-label={`Ожидается: ${title}`} className={INPUT} />
                      </td>
                      <td className="p-3">
                        <input
                          value={noteValue(p)}
                          onChange={e => setDraft(p.id, { note: e.target.value.slice(0, 200) })}
                          onKeyDown={e => { if (e.key === 'Enter') saveRow(p) }}
                          placeholder={p.preorder_expected_at ? `Ожидается ${formatPreorderDate(p.preorder_expected_at)}` : 'Скоро в продаже'}
                          aria-label={`Подпись: ${title}`}
                          className={INPUT}
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {dirty && (
                            <button type="button" onClick={() => saveRow(p)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-yellow-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-yellow-300 disabled:opacity-50" aria-label={`Сохранить: ${title}`}>
                              <AdminIcon name="check" className="h-4 w-4" />{saving ? '…' : 'Сохранить'}
                            </button>
                          )}
                          <button type="button" onClick={() => onEdit(p)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20" title="Открыть карточку" aria-label={`Карточка: ${title}`}><AdminIcon name="edit" className="h-4 w-4" /></button>
                          <button type="button" onClick={() => removeOne(p)} className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/25" title="Снять с предзаказа" aria-label={`Снять с предзаказа: ${title}`}><AdminIcon name="x" className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Карточки (мобильные) */}
          <div className="space-y-3 md:hidden">
            {list.map(p => {
              const { title, code } = codeOf(p.name)
              const img = imageUrl(p.main_image_url)
              const dirty = isDirty(p)
              return (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex gap-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="mt-1 h-4 w-4 flex-shrink-0 rounded accent-violet-500" />
                    {img ? <img src={img} alt="" className="h-14 w-14 flex-shrink-0 rounded-xl bg-white/10 object-cover" /> : <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-slate-500"><AdminIcon name="box" className="h-5 w-5" /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-white">{title} {code && <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-400">{code}</span>}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{[p.brand, categoryName(p.category_id)].filter(Boolean).join(' · ')}{!p.is_active && ' · скрыт'}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-500">Цена, ₽<input value={priceValue(p)} onChange={e => setDraft(p.id, { price: e.target.value })} inputMode="decimal" className={`${INPUT} mt-1 font-semibold text-yellow-300`} /></label>
                    <label className="text-[11px] text-slate-500">Ожидается<input type="date" value={dateValue(p)} onChange={e => setDraft(p.id, { date: e.target.value })} className={`${INPUT} mt-1`} /></label>
                    <label className="col-span-2 text-[11px] text-slate-500">Подпись на сайте<input value={noteValue(p)} onChange={e => setDraft(p.id, { note: e.target.value.slice(0, 200) })} placeholder="Старт продаж 26 сентября" className={`${INPUT} mt-1`} /></label>
                  </div>
                  <div className="mt-3 flex justify-end gap-1.5">
                    {dirty && <button type="button" onClick={() => saveRow(p)} disabled={savingId === p.id} className="rounded-lg bg-yellow-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Сохранить</button>}
                    <button type="button" onClick={() => onEdit(p)} aria-label="Карточка" className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white"><AdminIcon name="edit" className="h-4 w-4" /></button>
                    <button type="button" onClick={() => removeOne(p)} aria-label="Снять с предзаказа" className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300"><AdminIcon name="x" className="h-4 w-4" /></button>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Подпись показывается на сайте вместо даты: «Старт продаж 26 сентября», «Ожидается в октябре». Пустая подпись — на витрине «Ожидается {'{дата}'}», без даты — «Скоро в продаже». Enter в поле сохраняет строку.
          </p>
        </>
      )}

      {addOpen && (
        <AddToPreorderModal
          products={products.filter(p => !p.is_preorder && (p.condition || 'new') === 'new')}
          categoryName={categoryName}
          imageUrl={imageUrl}
          authFetch={authFetch}
          onDone={() => { setAddOpen(false); onRefresh() }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </>
  )
}

function StatCard({ label, value, tone, icon, hint }: { label: string; value: string; tone?: 'violet' | 'amber' | 'rose'; icon: 'sparkle' | 'clock' | 'alert' | 'eyeOff'; hint?: string }) {
  const tones = {
    violet: 'bg-violet-500/15 text-violet-300',
    amber: 'bg-amber-400/15 text-amber-300',
    rose: 'bg-rose-400/15 text-rose-300',
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone ? tones[tone] : 'bg-white/5 text-slate-400'}`}><AdminIcon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

// ── Модалка «Добавить товары в предзаказ» ─────────────────────────────────────
function AddToPreorderModal<P extends PreorderProduct>({ products, categoryName, imageUrl, authFetch, onDone, onClose }: {
  products: P[]
  categoryName: (id: string | null) => string
  imageUrl: (url?: string | null) => string
  authFetch: AuthFetch
  onDone: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tokens = q.split(/\s+/).filter(Boolean)
    const pool = tokens.length
      ? products.filter(p => {
          const hay = `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase()
          return tokens.every(t => hay.includes(t))
        })
      : products
    return [...pool].sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 80)
  }, [products, query])

  const toggle = (id: string) => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const pickAllMatches = () => setPicked(prev => { const next = new Set(prev); matches.forEach(p => next.add(p.id)); return next })

  const submit = async () => {
    if (picked.size === 0) return
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { product_ids: [...picked], is_preorder: true }
      if (date) payload.preorder_expected_at = date
      if (note.trim()) payload.preorder_note = note.trim()
      const res = await authFetch(`${API_BASE_URL}/api/products/preorder/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) { toast(await readError(res), 'error'); return }
      const data = await res.json().catch(() => ({ updated: picked.size }))
      toast(`В предзаказ: ${data.updated ?? picked.size} ${pluralRu(data.updated ?? picked.size, 'товар', 'товара', 'товаров')}`, 'success')
      onDone()
    } catch { toast('Ошибка запроса', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 pt-8 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="Добавить товары в предзаказ">
      <div className="flex w-full max-w-3xl flex-col rounded-3xl border border-white/10 bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()} style={{ maxHeight: 'calc(100vh - 4rem)' }}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h2 className="text-lg font-bold text-white">Добавить товары в предзаказ</h2>
            <p className="mt-1 text-sm text-slate-400">Отметьте карточки — они получат бейдж «Предзаказ» на сайте. Дату и подпись можно задать сразу для всех или позже по каждой строке.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Закрыть"><AdminIcon name="x" className="h-4 w-4" /></button>
        </div>

        <div className="border-b border-white/10 p-5">
          <div className="relative">
            <AdminIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Название, бренд или код модели — например, iPhone 18 Pro"
              className={`${INPUT} pl-9 py-2.5`}
              aria-label="Поиск товаров"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>{matches.length} {pluralRu(matches.length, 'совпадение', 'совпадения', 'совпадений')}{products.length > 80 && matches.length === 80 ? ' · показаны первые 80, уточните запрос' : ''}</span>
            {matches.length > 0 && <button type="button" onClick={pickAllMatches} className="text-violet-300 hover:text-violet-200">Отметить все найденные</button>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {matches.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">Ничего не найдено. Товар ещё не создан? Добавьте его в разделе «Товары», затем отметьте здесь.</div>
          ) : matches.map(p => {
            const { title, code } = codeOf(p.name)
            const img = imageUrl(p.main_image_url)
            const on = picked.has(p.id)
            return (
              <label key={p.id} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition ${on ? 'bg-violet-500/15' : 'hover:bg-white/[0.04]'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 rounded accent-violet-500" aria-label={`Выбрать ${title}`} />
                {img ? <img src={img} alt="" className="h-9 w-9 rounded-lg bg-white/10 object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-slate-500"><AdminIcon name="box" className="h-4 w-4" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{title} {code && <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">{code}</span>}{!p.is_active && <span className="ml-2 text-xs text-rose-400">(скрыт)</span>}</div>
                  <div className="truncate text-xs text-slate-500">{[p.brand, categoryName(p.category_id)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-sm font-semibold text-yellow-300">{formatPrice(p.price)}</div>
              </label>
            )
          })}
        </div>

        <div className="border-t border-white/10 p-5">
          <div className="grid gap-3 sm:grid-cols-[170px_1fr]">
            <label className="text-xs text-slate-400">Ожидается (для всех)
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${INPUT} mt-1`} />
            </label>
            <label className="text-xs text-slate-400">Подпись на сайте (для всех)
              <input value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder="Старт продаж 26 сентября" className={`${INPUT} mt-1`} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-sm text-slate-400">Выбрано: <span className="font-semibold text-white">{picked.size}</span></span>
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
            <button type="button" onClick={submit} disabled={busy || picked.size === 0} className={BTN_PRIMARY}>
              <AdminIcon name="sparkle" className="h-4 w-4" />{busy ? 'Добавляем…' : `Добавить ${picked.size || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const PREORDER_CHIP_CLASS = CHIP
