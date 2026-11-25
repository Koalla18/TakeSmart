import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { matchesSearchStrict } from '../../lib/searchRank'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { call, type Api } from './installsApi'
import { BTN_ROW, CARD, INPUT } from './installsUi'

// ─────────────────────────────────────────────────────────────────────────────
// Прайс бота. Слева — что сейчас в базе, справа — новые цены (одно сообщение
// поставщика или весь прайс). Разница видна сразу и на обеих сторонах, меняется
// только после «Применить». Повторы во вставленном — берётся меньшая цена.
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceConfig { price_list: string; price_list_can_undo?: boolean; price_list_updated_at?: string | null }
interface Item { name: string; price: number; in_stock: boolean; country: string | null; sim: string | null; few?: boolean }
interface Base { items: Item[]; count: number; errors: string[] }
type Kind = 'changed' | 'added' | 'removed'
interface Change { id: string; kind: Kind; item: Item; old_price: number | null; old_key: string | null; warning: string | null }
interface Preview { base_hash: string; changes: Change[]; unchanged: number; new_count: number; base_errors: number; errors: string[]; duplicates: string[] }
type Mode = 'models' | 'full' | 'add'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'models', label: 'Только эти модели', hint: 'Если у модели из сообщения (той же страны и SIM) чего-то в нём нет — значит, этого больше нет в наличии. Остальные модели не трогаются.' },
  { id: 'full', label: 'Это весь прайс', hint: 'Всё, чего нет во вставленном тексте, уйдёт из базы.' },
  { id: 'add', label: 'Ничего не удалять', hint: 'Только меняем цены и добавляем новое — удобно для пары строк.' },
]

const GROUPS: { kind: Kind; title: string; cls: string }[] = [
  { kind: 'changed', title: 'Изменится цена', cls: 'text-yellow-300' },
  { kind: 'added', title: 'Добавится', cls: 'text-emerald-300' },
  { kind: 'removed', title: 'Уйдёт из базы', cls: 'text-rose-300' },
]

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const itemKey = (it: Item) => `${it.name}|${it.country ?? ''}|${it.sim ?? ''}`
const meta = (it: Item) => [it.country, it.sim].filter(Boolean).join(' · ')

function Name({ item, className = 'text-slate-200' }: { item: Item; className?: string }) {
  return (
    <span className="min-w-0">
      <span className={className}>{item.name}</span>
      {meta(item) && <span className="ml-1.5 text-xs text-slate-500">{meta(item)}</span>}
      {item.few && <span className="ml-1.5 text-xs text-amber-400">осталось мало</span>}
    </span>
  )
}

export function PriceListTab<C extends PriceConfig>({ api, config, setConfig }: { api: Api; config: C; setConfig: (c: C) => void }) {
  const [base, setBase] = useState<Base | null>(null)
  const [search, setSearch] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('models')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [comparing, setComparing] = useState(false)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(() => {
    let alive = true
    call<Base>(api, '/price-list/check', { method: 'POST', body: { text: config.price_list } }).then(b => { if (alive && b) setBase(b) })
    return () => { alive = false }
  }, [api, config.price_list])

  const compare = useCallback(async () => {
    const id = ++request.current
    if (!text.trim()) { setPreview(null); setComparing(false); return }
    setComparing(true)
    const p = await call<Preview>(api, '/price-list/preview', { method: 'POST', body: { text, mode } })
    if (id !== request.current) return       // пока ждали ответ, текст уже поменяли
    setPreview(p)
    setComparing(false)
  }, [api, text, mode])

  // Сравниваем сами, чуть подождав после вставки; пока считается, «Применить» выключена
  useEffect(() => {
    if (text.trim()) setComparing(true)
    const t = window.setTimeout(compare, 400)
    return () => window.clearTimeout(t)
  }, [compare, config.price_list, text])

  const chosen = preview?.changes.filter(c => !skip.has(c.id)) ?? []

  const gone = chosen.filter(c => c.kind === 'removed').length

  const apply = async () => {
    if (!preview) return
    if (gone >= 20 && !(await confirmDialog({ title: 'Убрать много позиций?', message: `Из базы уйдёт позиций: ${gone}. Бот перестанет их предлагать.`, confirmLabel: 'Применить', danger: true }))) return
    setBusy(true)
    const c = await call<C>(api, '/price-list/apply', { method: 'POST', body: { text, mode, base_hash: preview.base_hash, skip: [...skip] } })
    setBusy(false)
    if (!c) { compare(); return }
    setConfig(c)
    setText(''); setPreview(null); setSkip(new Set()); setRaw(null)
    toast(`Применено изменений: ${chosen.length} — бот уже отвечает по новым ценам`, 'success')
  }

  const undo = async () => {
    if (!(await confirmDialog({ title: 'Отменить последнее изменение?', message: 'Прайс вернётся к тому, каким был до него.', confirmLabel: 'Вернуть' }))) return
    const c = await call<C>(api, '/price-list/undo', { method: 'POST' })
    if (c) { setConfig(c); setRaw(null); toast('Вернули прежний прайс', 'success') }
  }

  const saveRaw = async () => {
    if (raw === null) return
    setBusy(true)
    const c = await call<C>(api, '/settings', { method: 'PUT', body: { price_list: raw } })
    setBusy(false)
    if (c) { setConfig(c); setRaw(null); toast('Прайс сохранён', 'success') }
  }

  // Что произойдёт с каждой строкой базы — подсвечиваем слева
  const pending = useMemo(() => new Map(chosen.filter(c => c.old_key).map(c => [c.old_key as string, c])), [chosen])
  const added = chosen.filter(c => c.kind === 'added')
  const visible = useMemo(() => {
    const items = base?.items ?? []
    const found = search.trim() ? items.filter(it => matchesSearchStrict(search, `${it.name} ${meta(it)}`)) : items
    const sorted = [...found].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
    // затронутые изменениями — наверх, чтобы их не искать
    return sorted.sort((a, b) => Number(pending.has(itemKey(b))) - Number(pending.has(itemKey(a))))
  }, [base, search, pending])

  const toggle = (ids: string[], on: boolean) => setSkip(prev => {
    const next = new Set(prev)
    ids.forEach(id => (on ? next.delete(id) : next.add(id)))
    return next
  })

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* ── Сейчас в базе ── */}
        <div className={CARD}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-white">Сейчас в базе{base ? <span className="ml-2 font-normal text-slate-400">· {base.count}</span> : null}</h3>
            {config.price_list_can_undo && <button type="button" onClick={undo} className={BTN_ROW}>Отменить последнее изменение</button>}
          </div>
          {config.price_list_updated_at && <p className="mb-2 text-xs text-slate-500">Обновлён {new Date(config.price_list_updated_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>}
          <input className={INPUT} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: 17 pro 256 orange" />
          <div className="mt-2 h-[60vh] divide-y divide-white/[0.05] overflow-y-auto pr-1 text-sm">
            {!search && added.map(c => (
              <div key={c.id} className="flex justify-between gap-3 bg-emerald-400/[0.07] px-1.5 py-1.5">
                <Name item={c.item} className="text-emerald-200" />
                <span className="shrink-0 tabular-nums text-emerald-200">новое · {money(c.item.price)}</span>
              </div>
            ))}
            {visible.map(it => {
              const c = pending.get(itemKey(it))
              const gone = c?.kind === 'removed'
              return (
                <div key={itemKey(it)} className={`flex justify-between gap-3 px-1.5 py-1.5 ${gone ? 'bg-rose-400/[0.07]' : c ? 'bg-yellow-400/[0.07]' : ''}`}>
                  <Name item={it} className={gone || !it.in_stock ? 'text-slate-500 line-through' : 'text-slate-200'} />
                  <span className="shrink-0 tabular-nums">
                    {c?.kind === 'changed'
                      ? <><span className="text-slate-500 line-through">{money(it.price)}</span> <span className="text-yellow-300">{money(c.item.price)}</span></>
                      : <span className={gone ? 'text-rose-300' : 'text-white'}>{gone ? 'уйдёт' : money(it.price)}</span>}
                  </span>
                </div>
              )
            })}
            {base && base.count === 0 && !added.length && <div className="py-6 text-slate-500">База пуста — вставьте справа прайс целиком.</div>}
          </div>
        </div>

        {/* ── Новые цены: на телефоне сверху — туда вставляют ── */}
        <div className={`${CARD} order-first lg:order-none`}>
          <h3 className="mb-3 font-semibold text-white">Новые цены</h3>
          <textarea className={`${INPUT} h-40 font-mono text-[13px]`} value={text} onChange={e => { setText(e.target.value); setSkip(new Set()) }}
            placeholder={'Вставьте сообщение как есть:\n🇯🇵 17 Pro Max\n17 Pro Max 256 Orange eSim — 97.500\n17 Pro Max 256 Blue eSim — 99.000'} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MODES.map(m => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${mode === m.id ? 'bg-yellow-400 font-semibold text-slate-950' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}>{m.label}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{MODES.find(m => m.id === mode)?.hint}</p>

          {!text.trim() ? null : !preview ? <div className="mt-4 text-sm text-slate-400">{comparing ? 'Сравниваем…' : 'Не удалось сравнить.'}</div> : (
            <div className={`mt-4 space-y-3 transition-opacity ${comparing ? 'opacity-50' : ''}`}>
              <p className="text-sm text-slate-400">Прочитано позиций: {preview.new_count} · без изменений в базе: {preview.unchanged}</p>
              {preview.new_count === 0 && <div className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">Не нашёл ни одной позиции с ценой — база не изменится.</div>}
              {preview.errors.length > 0 && (
                <div className="rounded-xl bg-rose-400/10 p-3 text-xs text-rose-200">
                  <div className="mb-1 font-semibold">Эти строки не прочитались ({preview.errors.length})</div>
                  {preview.errors.map(e => <div key={e}>{e}</div>)}
                </div>
              )}
              {preview.duplicates.length > 0 && (
                <div className="rounded-xl bg-white/5 p-3 text-xs text-slate-300">
                  <div className="mb-1 font-semibold">Повторы — взята меньшая цена ({preview.duplicates.length})</div>
                  {preview.duplicates.map(d => <div key={d}>{d}</div>)}
                </div>
              )}
              {preview.base_errors > 0 && preview.changes.length > 0 && <div className="text-xs text-amber-300">В старой базе строк, которые бот не читал: {preview.base_errors}. После применения они удалятся.</div>}
              {mode !== 'add' && gone > chosen.length - gone && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">
                  <span>Из базы уйдёт позиций: {gone}. Если прислали только часть цен — не удаляйте.</span>
                  <button type="button" onClick={() => setMode('add')} className={BTN_ROW}>Ничего не удалять</button>
                </div>
              )}
              {preview.new_count > 0 && preview.changes.length === 0 && <div className="text-sm text-emerald-300">Всё совпадает с базой — менять нечего.</div>}
              <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                {GROUPS.map(g => {
                  const list = preview.changes.filter(c => c.kind === g.kind)
                  if (!list.length) return null
                  const ids = list.map(c => c.id)
                  const on = ids.filter(id => !skip.has(id)).length
                  return (
                    <div key={g.kind}>
                      <label className={`flex cursor-pointer items-center gap-2 py-1 text-sm font-semibold ${g.cls}`}>
                        <input type="checkbox" className="accent-yellow-400" checked={on === ids.length}
                          ref={el => { if (el) el.indeterminate = on > 0 && on < ids.length }}
                          onChange={e => toggle(ids, e.target.checked)} />
                        {g.title}: {on}{on !== ids.length ? ` из ${ids.length}` : ''}
                      </label>
                      <div className="divide-y divide-white/[0.05] text-sm">
                        {list.map(c => (
                          <label key={c.id} className={`flex cursor-pointer items-start gap-2 py-1.5 ${skip.has(c.id) ? 'opacity-40' : ''}`}>
                            <input type="checkbox" className="mt-1 accent-yellow-400" checked={!skip.has(c.id)} onChange={e => toggle([c.id], e.target.checked)} />
                            <span className="min-w-0 flex-1">
                              <Name item={c.item} />
                              {c.warning && <span className="block text-xs text-amber-300">Проверьте: {c.warning}</span>}
                            </span>
                            <span className="shrink-0 text-right tabular-nums">
                              {c.kind === 'changed' && c.old_price !== null && c.old_price !== c.item.price && <span className="mr-1.5 text-slate-500 line-through">{money(c.old_price)}</span>}
                              <span className="text-white">{money(c.item.price)}</span>
                              {c.kind === 'changed' && c.old_price !== null && c.old_price !== c.item.price && (
                                <span className={`ml-1.5 text-xs ${c.item.price > c.old_price ? 'text-rose-300' : 'text-emerald-300'}`}>{c.item.price > c.old_price ? '+' : '−'}{Math.abs(Math.round(c.item.price - c.old_price)).toLocaleString('ru-RU')}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {preview.changes.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button type="button" onClick={() => { setText(''); setSkip(new Set()) }} className={BTN_SECONDARY}>Очистить</button>
                  <button type="button" onClick={apply} disabled={busy || comparing || !chosen.length} className={BTN_PRIMARY}>{busy ? 'Применяем…' : `Применить: ${chosen.length}`}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Весь текст базы — на случай ручной правки ── */}
      <details className={CARD} onToggle={e => { if (!(e.target as HTMLDetailsElement).open) setRaw(null) }}>
        <summary className="cursor-pointer text-sm font-semibold text-white">Весь текст базы (ручная правка)</summary>
        {base?.errors.length ? <div className="mt-3 space-y-1 text-xs text-rose-300">{base.errors.map(e => <div key={e}>{e}</div>)}</div> : null}
        <textarea className={`${INPUT} mt-3 h-[45vh] font-mono text-[13px]`} value={raw ?? config.price_list} onChange={e => setRaw(e.target.value)} />
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={saveRaw} disabled={busy || raw === null || raw === config.price_list} className={BTN_PRIMARY}>Сохранить текст</button>
        </div>
      </details>
    </div>
  )
}
