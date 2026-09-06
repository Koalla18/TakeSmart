/**
 * Командная строка цен: «наушники apple +2000», «17 pro −1500», «galaxy s26 512 = 89990».
 *
 * Текст (или голос через встроенное распознавание браузера) уходит на
 * POST /api/products/prices/command — сервер разбирает команду и возвращает
 * ПРЕДПРОСМОТР: какие товары попали и какой станет цена. Ничего не меняется,
 * пока сотрудник не нажмёт «Применить» с галочками. Последний применённый
 * пакет можно откатить одной кнопкой (снимок цен хранится в этом браузере).
 *
 * Компонент общий для PWA «Цены» и админки: сам подтягивает словарь подсказок
 * (категории, бренды, модели каталога) публичными ручками.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAuthHeaders } from '../lib/auth'
import { API_BASE_URL } from '../lib/config'
import { toast } from '../lib/toast'

interface CommandOperation { kind: 'delta' | 'percent' | 'set'; value: number; label: string }
interface CommandItem {
  id: string; name: string; color: string | null; category: string | null
  price: number; discount_price: number | null; new_price: number | null; new_discount_price: number | null
  is_active: boolean; valid: boolean; reason: string | null
}
interface PreviousPrice { id: string; price: number; discount_price: number | null }
interface CommandResult {
  text: string; operation: CommandOperation | null; filters: Record<string, string[]>; include_inactive: boolean
  items: CommandItem[]; total_matched: number; applied: number; previous: PreviousPrice[]; warnings: string[]
}
interface UndoBatch { at: string; text: string; items: PreviousPrice[] }

const UNDO_KEY = 'takesmart_price_undo'
const EXAMPLES = ['наушники apple +2000', '17 pro −1500', 'galaxy s26 512 = 89990', 'все iphone кроме 15 +5%']

const fmtRub = (n: number | string) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₽'
function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

function readUndo(): UndoBatch | null {
  try { const raw = localStorage.getItem(UNDO_KEY); return raw ? JSON.parse(raw) as UndoBatch : null } catch { return null }
}
function writeUndo(batch: UndoBatch | null) {
  try { batch ? localStorage.setItem(UNDO_KEY, JSON.stringify(batch)) : localStorage.removeItem(UNDO_KEY) } catch { /* приватный режим */ }
}

// Встроенное распознавание речи (Chrome, Android, Safari 14.1+). Без него кнопки микрофона просто нет.
type SpeechRecognitionCtor = new () => {
  lang: string; interimResults: boolean; maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null
  start: () => void; stop: () => void; abort: () => void
}
function speechCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function MicIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6" />
    </svg>
  )
}

export function PriceCommandBar({ onApplied, autoFocus = false }: { onApplied?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [vocab, setVocab] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<CommandResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [undo, setUndo] = useState<UndoBatch | null>(() => readUndo())
  const [listening, setListening] = useState(false)
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const canSpeak = useMemo(() => speechCtor() !== null, [])

  // Словарь подсказок: категории, кнопки моделей и бренды каталога
  useEffect(() => {
    let alive = true
    ;(async () => {
      const words = new Set<string>()
      try {
        const res = await fetch(`${API_BASE_URL}/api/categories?limit=100`, { headers: getAuthHeaders() })
        if (res.ok) {
          const data = await res.json()
          const items: { name?: string; quick_filters?: { label?: string }[] }[] = data.items ?? data
          for (const c of items) { if (c.name) words.add(c.name); for (const qf of c.quick_filters ?? []) if (qf.label) words.add(qf.label) }
        }
      } catch { /* подсказки — не критично */ }
      try {
        const res = await fetch(`${API_BASE_URL}/api/brands`, { headers: getAuthHeaders() })
        if (res.ok) for (const b of (await res.json()) as { name?: string }[]) if (b.name) words.add(b.name)
      } catch { /* то же */ }
      if (alive) setVocab([...words])
    })()
    return () => { alive = false }
  }, [])

  const lastWord = text.split(/\s+/).pop()?.toLowerCase() ?? ''
  const hints = useMemo(() => {
    if (lastWord.length < 2 || /^[+\-=−\d%]/.test(lastWord)) return []
    return vocab.filter(v => v.toLowerCase().includes(lastWord) && v.toLowerCase() !== lastWord).slice(0, 8)
  }, [vocab, lastWord])

  const applyHint = (hint: string) => {
    const parts = text.split(/\s+/); parts.pop()
    setText([...parts, hint, ''].join(' ').replace(/\s+/g, ' ').trimStart())
    inputRef.current?.focus()
  }

  const runPreview = useCallback(async (command?: string) => {
    const cmd = (command ?? text).trim()
    if (!cmd) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/products/prices/command`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: cmd, apply: false }),
      })
      if (!res.ok) { toast('Не удалось разобрать команду', 'error'); return }
      const data: CommandResult = await res.json()
      setPreview(data)
      setSelected(new Set(data.items.filter(it => it.valid).map(it => it.id)))
    } catch { toast('Нет связи с сервером', 'error') }
    finally { setLoading(false) }
  }, [text])

  const apply = async () => {
    if (!preview || !preview.operation || selected.size === 0) return
    setApplying(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/products/prices/command`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: preview.text, apply: true, product_ids: [...selected], include_inactive: preview.include_inactive }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast(typeof err.detail === 'string' ? err.detail : 'Не удалось применить', 'error'); return
      }
      const data: CommandResult = await res.json()
      const batch: UndoBatch = { at: new Date().toISOString(), text: preview.text, items: data.previous }
      writeUndo(batch); setUndo(batch)
      toast(`Изменено ${data.applied} ${pluralRu(data.applied, 'цена', 'цены', 'цен')} · ${preview.operation.label}`, 'success')
      setPreview(null); setText('')
      onApplied?.()
    } catch { toast('Нет связи с сервером', 'error') }
    finally { setApplying(false) }
  }

  const undoLast = async () => {
    if (!undo || undo.items.length === 0) return
    setApplying(true)
    try {
      for (let i = 0; i < undo.items.length; i += 500) {
        const chunk = undo.items.slice(i, i + 500).map(p => ({ id: p.id, price: p.price, discount_price: p.discount_price }))
        const res = await fetch(`${API_BASE_URL}/api/products/prices/bulk`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ items: chunk }),
        })
        if (!res.ok) { toast('Откат не удался — проверьте цены вручную', 'error'); return }
      }
      toast(`Откатили ${undo.items.length} ${pluralRu(undo.items.length, 'цену', 'цены', 'цен')}`, 'success')
      writeUndo(null); setUndo(null)
      onApplied?.()
    } catch { toast('Нет связи с сервером', 'error') }
    finally { setApplying(false) }
  }

  const toggleListening = () => {
    if (listening) { recRef.current?.stop(); return }
    const Ctor = speechCtor(); if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'ru-RU'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = e => {
      const said = Array.from(e.results).map(r => r[0]?.transcript ?? '').join(' ').trim()
      if (said) { setText(said); void runPreview(said) }
    }
    rec.onerror = e => { setListening(false); if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Микрофон недоступен — напишите команду текстом', 'error') }
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }
  useEffect(() => () => recRef.current?.abort(), [])

  const toggleItem = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const filterChips = preview ? [
    ...(preview.filters.categories ?? []).map(v => ({ kind: 'Категория', v })),
    ...(preview.filters.brands ?? []).map(v => ({ kind: 'Бренд', v })),
    ...(preview.filters.tokens ?? []).map(v => ({ kind: 'В названии', v })),
    ...(preview.filters.exclude ?? []).map(v => ({ kind: 'Кроме', v })),
  ] : []

  return (
    <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.04] p-3" data-testid="price-command">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runPreview() } }}
          placeholder="Команда: наушники apple +2000 · 17 pro −1500 · galaxy s26 512 = 89990"
          aria-label="Команда изменения цен"
          autoFocus={autoFocus}
          enterKeyHint="go"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-yellow-400/60"
        />
        {canSpeak && (
          <button
            type="button"
            onClick={toggleListening}
            aria-label={listening ? 'Остановить запись' : 'Сказать команду голосом'}
            aria-pressed={listening}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition ${listening ? 'animate-pulse bg-rose-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'}`}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={!text.trim() || loading}
          className="flex-shrink-0 rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-yellow-300 disabled:opacity-40"
        >
          {loading ? '…' : 'Показать'}
        </button>
      </div>

      {hints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {hints.map(h => (
            <button key={h} type="button" onClick={() => applyHint(h)} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/[0.14]">{h}</button>
          ))}
        </div>
      )}
      {!preview && !text && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span>Например:</span>
          {EXAMPLES.map(ex => <button key={ex} type="button" onClick={() => { setText(ex); void runPreview(ex) }} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-slate-400 transition hover:bg-white/[0.12] hover:text-white">{ex}</button>)}
          {listening && <span className="text-rose-300">слушаю…</span>}
        </div>
      )}
      {undo && !preview && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="truncate">Последний пакет: {undo.items.length} {pluralRu(undo.items.length, 'цена', 'цены', 'цен')} · «{undo.text}»</span>
          <button type="button" onClick={() => void undoLast()} disabled={applying} className="flex-shrink-0 rounded-lg bg-white/10 px-2.5 py-1 font-medium text-white transition hover:bg-white/15 disabled:opacity-40">Откатить</button>
        </div>
      )}

      {preview && (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70" data-testid="price-command-preview">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
            <span className={`rounded-lg px-2 py-0.5 text-sm font-bold ${preview.operation ? 'bg-yellow-400 text-gray-950' : 'bg-rose-500/20 text-rose-300'}`}>
              {preview.operation ? preview.operation.label : 'операция не понята'}
            </span>
            {filterChips.map(({ kind, v }) => (
              <span key={kind + v} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-slate-300"><span className="text-slate-500">{kind}: </span>{v}</span>
            ))}
            {preview.include_inactive && <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-slate-300">и скрытые</span>}
            <span className="ml-auto text-xs text-slate-400">{preview.total_matched} {pluralRu(preview.total_matched, 'товар', 'товара', 'товаров')} · выбрано {selected.size}</span>
          </div>
          {preview.warnings.map(w => <div key={w} className="border-b border-white/10 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">{w}</div>)}
          {preview.items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">Ничего не нашёл. Попробуйте название модели, бренд или категорию — подсказки появятся при вводе.</div>
          ) : (
            <div className="max-h-[50vh] divide-y divide-white/[0.05] overflow-y-auto">
              {preview.items.map(it => (
                <label key={it.id} className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${it.valid ? '' : 'opacity-50'}`}>
                  <input type="checkbox" checked={selected.has(it.id)} disabled={!it.valid} onChange={() => toggleItem(it.id)} className="h-4 w-4 flex-shrink-0 accent-yellow-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{it.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {[it.category, !it.is_active ? 'скрыт' : null, it.reason].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right text-xs tabular-nums">
                    <span className="text-slate-500 line-through">{fmtRub(it.price)}</span>
                    {it.new_price != null && <span className="ml-1.5 font-semibold text-yellow-300">{fmtRub(it.new_price)}</span>}
                    {it.discount_price != null && (
                      <span className="block text-[10px] text-slate-500">скидка {fmtRub(it.discount_price)}{it.new_discount_price != null ? ` → ${fmtRub(it.new_discount_price)}` : ' → снята'}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
            <button type="button" onClick={() => setPreview(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition hover:text-white">Отмена</button>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={!preview.operation || selected.size === 0 || applying}
              className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-yellow-300 disabled:opacity-40"
            >
              {applying ? 'Применяю…' : `Применить ${selected.size}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
