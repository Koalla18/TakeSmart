import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { API_BASE_URL } from '../lib/config'

// ─────────────────────────────────────────────────────────────────────────────
// Комментарии сотрудников к заказу — общая лента для админки и приложения
// «Заказы» (/app). Видят только сотрудники: покупатель их не получает.
// Под одной учёткой работают несколько человек, поэтому подпись — имя,
// которое сотрудник указал на своём устройстве (запоминается в браузере).
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderComment {
  id: string
  order_id: string
  author_name: string
  body: string
  created_at: string
  edited_at?: string | null
}

/** Последний комментарий в списке заказов — одной строкой */
export interface OrderCommentPreview {
  author_name: string
  body: string
  created_at: string
}

export type OrderCommentsRequest = (url: string, init?: RequestInit) => Promise<Response>

const NAME_KEY = 'takesmart_staff_name'
const MAX_LENGTH = 2000
const POLL_MS = 30_000
const QUICK_PHRASES = ['Позвонил клиенту', 'Не дозвонился', 'Ждём оплату', 'Товар отложен', 'Клиент заберёт сам']

// Недописанный комментарий живёт на устройстве по заказу: карточку закрыли кликом
// мимо или сессия входа истекла — текст вернётся при следующем открытии.
const DRAFT_PREFIX = 'takesmart_comment_draft:'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function readDraft(orderId: string): string {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + orderId)
    if (!raw) return ''
    const draft = JSON.parse(raw) as { text?: unknown; at?: unknown }
    if (typeof draft.text !== 'string' || typeof draft.at !== 'number' || Date.now() - draft.at > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_PREFIX + orderId)
      return ''
    }
    return draft.text.slice(0, MAX_LENGTH)
  } catch { return '' }
}

function storeDraft(orderId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_PREFIX + orderId, JSON.stringify({ text, at: Date.now() }))
    else localStorage.removeItem(DRAFT_PREFIX + orderId)
  } catch { /* хранилище недоступно — черновик просто не переживёт закрытие */ }
}

export function readStaffName(): string {
  try { return (localStorage.getItem(NAME_KEY) || '').trim() } catch { return '' }
}

function storeStaffName(name: string) {
  try { localStorage.setItem(NAME_KEY, name) } catch { /* приватный режим — просто не запомним */ }
}

/** Превью для списка заказов из полной ленты — тот же вид, что отдаёт сервер */
export function commentsPreview(comments: OrderComment[]): { comments_count: number; last_comment: OrderCommentPreview | null } {
  const last = comments[comments.length - 1]
  return {
    comments_count: comments.length,
    last_comment: last ? { author_name: last.author_name, body: last.body.replace(/\s+/g, ' ').trim(), created_at: last.created_at } : null,
  }
}

// ── Внешний вид ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['bg-rose-500/80', 'bg-amber-500/80', 'bg-emerald-500/80', 'bg-sky-500/80', 'bg-violet-500/80', 'bg-fuchsia-500/80', 'bg-cyan-500/80', 'bg-orange-500/80']

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.toLowerCase().charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)
  return letters.toUpperCase()
}

export function StaffAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
  return (
    <span aria-hidden="true" className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${box} ${avatarColor(name)}`}>
      {initials(name)}
    </span>
  )
}

export function CommentIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </svg>
  )
}

function LockIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function PencilIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m15 5 4 4M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
    </svg>
  )
}

function SendIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** «только что», «12 мин назад», «сегодня, 14:05», «вчера, 18:20», «12 окт., 18:40» */
export function commentTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMin = (now.getTime() - d.getTime()) / 60000
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (diffMin < 1) return 'только что'
  if (diffMin < 60 && sameDay(d, now)) return `${Math.floor(diffMin)} мин назад`
  if (sameDay(d, now)) return `сегодня, ${time}`
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return `вчера, ${time}`
  if (d.getFullYear() === now.getFullYear()) return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`
  return `${d.toLocaleDateString('ru-RU')}, ${time}`
}

function fullTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sortComments(list: OrderComment[]): OrderComment[] {
  return [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id))
}

async function errorText(res: Response, fallback: string): Promise<string> {
  if (res.status === 422) return 'Комментарий пустой или длиннее 2000 символов'
  try {
    const data = await res.json()
    if (typeof data?.detail === 'string') return data.detail
  } catch { /* не JSON */ }
  return `${fallback} (код ${res.status})`
}

const NETWORK_ERROR = 'Нет связи с сервером — текст на месте, попробуйте ещё раз'

/** Клавиша отправки для подсказки: на Mac — ⌘, в остальных системах — Ctrl */
function sendShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl + Enter'
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ + Enter' : 'Ctrl + Enter'
}

// ── Лента ────────────────────────────────────────────────────────────────────

export function OrderComments({
  orderId, initial, request, onChange,
}: {
  orderId: string
  initial?: OrderComment[] | null
  /** fetch с авторизацией: в админке — authFetch, в приложении — свой с выходом по 401 */
  request: OrderCommentsRequest
  /** Лента изменилась — обновить счётчик и превью в списке заказов */
  onChange?: (comments: OrderComment[]) => void
}) {
  const headingId = useId()
  const [comments, setComments] = useState<OrderComment[]>(() => sortComments(initial || []))
  const [text, setText] = useState(() => readDraft(orderId))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(readStaffName)
  const [nameDraft, setNameDraft] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameHint, setNameHint] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const textRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const firstRender = useRef(true)
  const shortcut = useMemo(sendShortcutLabel, [])

  useEffect(() => { storeDraft(orderId, text) }, [orderId, text])

  // Счётчик и превью в списке заказов — после каждого изменения ленты
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    onChangeRef.current?.(comments)
  }, [comments])

  // «5 мин назад» должно стареть, пока карточка открыта
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Коллега мог написать с другого устройства — подтягиваем ленту раз в 30 с
  // и сразу при возвращении на вкладку. В фоне не опрашиваем.
  const editingRef = useRef(false)
  editingRef.current = editingId !== null
  const refresh = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    try {
      const res = await request(`${API_BASE_URL}/api/orders/${orderId}/comments`)
      if (!res.ok) return
      const list: OrderComment[] = await res.json()
      if (!Array.isArray(list)) return
      setComments(prev => {
        const next = sortComments(list)
        const same = prev.length === next.length && prev.every((c, i) => c.id === next[i].id && c.body === next[i].body && c.edited_at === next[i].edited_at)
        return same ? prev : next
      })
      // Комментарий, который правили, удалили с другого устройства — выходим из правки
      if (editingRef.current) setEditingId(id => (id && list.some(c => c.id === id) ? id : null))
    } catch { /* нет сети — попробуем в следующий раз */ }
  }, [orderId, request])

  useEffect(() => {
    const id = window.setInterval(refresh, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  // Поле растёт вместе с текстом (до ~10 строк)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])
  useLayoutEffect(() => {
    const el = editRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [editText, editingId])

  const myName = name.trim().toLowerCase()

  const saveName = (value: string): string => {
    const clean = value.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!clean) return ''
    storeStaffName(clean)
    setName(clean)
    setNameHint(false)
    setEditingName(false)
    return clean
  }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    let author = name.trim()
    if (!author || editingName) author = saveName(nameDraft) || (editingName ? author : '')
    if (!author) {
      setNameHint(true)
      nameRef.current?.focus()
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await request(`${API_BASE_URL}/api/orders/${orderId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: author, body }),
      })
      if (!res.ok) { setError(await errorText(res, 'Не удалось отправить')); return }
      const created: OrderComment = await res.json()
      setComments(prev => sortComments([...prev.filter(c => c.id !== created.id), created]))
      setText('')
      textRef.current?.focus()
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setSending(false)
    }
  }

  const startEdit = (c: OrderComment) => {
    setConfirmId(null)
    setEditError(null)
    setEditingId(c.id)
    setEditText(c.body)
    window.setTimeout(() => {
      const el = editRef.current
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    }, 0)
  }

  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditError(null) }

  const saveEdit = async (c: OrderComment) => {
    const body = editText.trim()
    if (!body || savingEdit) return
    if (body === c.body) { cancelEdit(); return }
    setSavingEdit(true)
    setEditError(null)
    try {
      const res = await request(`${API_BASE_URL}/api/orders/${orderId}/comments/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.status === 404) {
        setComments(prev => prev.filter(x => x.id !== c.id))
        cancelEdit()
        return
      }
      if (!res.ok) { setEditError(await errorText(res, 'Не удалось сохранить')); return }
      const updated: OrderComment = await res.json()
      setComments(prev => prev.map(x => (x.id === updated.id ? updated : x)))
      cancelEdit()
    } catch {
      setEditError(NETWORK_ERROR)
    } finally {
      setSavingEdit(false)
    }
  }

  const remove = async (c: OrderComment) => {
    if (deletingId) return
    setDeletingId(c.id)
    try {
      const res = await request(`${API_BASE_URL}/api/orders/${orderId}/comments/${c.id}`, { method: 'DELETE' })
      // 404 — его уже удалили с другого устройства: итог тот же
      if (res.ok || res.status === 204 || res.status === 404) {
        setComments(prev => prev.filter(x => x.id !== c.id))
        setConfirmId(null)
      } else {
        setError(await errorText(res, 'Не удалось удалить'))
      }
    } catch {
      setError('Нет связи с сервером — комментарий не удалён')
    } finally {
      setDeletingId(null)
    }
  }

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
  }

  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>, c: OrderComment) => {
    // Esc закрывает только правку, а не всю карточку заказа
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(c) }
  }

  const insertPhrase = (phrase: string) => {
    setText(phrase)
    window.setTimeout(() => {
      const el = textRef.current
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
    }, 0)
  }

  const left = MAX_LENGTH - text.length
  const canSend = text.trim().length > 0 && !sending

  return (
    <section aria-labelledby={headingId} data-order-comments className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-400/15 text-yellow-300"><CommentIcon className="h-4 w-4" /></span>
          <h3 id={headingId} className="text-sm font-semibold text-white">Комментарии сотрудников</h3>
          {comments.length > 0 && (
            <span data-comments-count className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-slate-300">{comments.length}</span>
          )}
        </div>
        <span className="flex items-center gap-1 text-[11px] text-slate-500"><LockIcon />видят только сотрудники</span>
      </header>

      {comments.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          Пока пусто. Напишите коллегам, что сделано по заказу — звонок, договорённость, оплата.
        </p>
      ) : (
        <ol className="mt-4 space-y-4" aria-label="Комментарии">
          {comments.map(c => {
            const mine = myName !== '' && c.author_name.trim().toLowerCase() === myName
            const editing = editingId === c.id
            return (
              <li key={c.id} data-comment-id={c.id} className="group relative flex gap-3">
                <StaffAvatar name={c.author_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 [@media(hover:hover)]:pr-36">
                    <span className="text-sm font-semibold text-white">{c.author_name}</span>
                    {mine && <span className="rounded bg-white/5 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">вы</span>}
                    <time dateTime={c.created_at} title={fullTime(c.created_at)} className="text-xs text-slate-500">{commentTime(c.created_at)}</time>
                    {c.edited_at && (
                      <span title={`Изменён ${fullTime(c.edited_at)}`} className="text-xs text-slate-600">· изменён</span>
                    )}
                  </div>

                  {editing ? (
                    <div className="mt-2">
                      <textarea
                        ref={editRef}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => onEditKey(e, c)}
                        maxLength={MAX_LENGTH}
                        rows={2}
                        aria-label="Текст комментария"
                        className="block w-full resize-none rounded-xl border border-yellow-400/40 bg-slate-950/60 px-3 py-2 text-base leading-relaxed text-white outline-none sm:text-sm"
                      />
                      {editError && <p className="mt-1.5 text-xs text-rose-300">{editError}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEdit(c)}
                          disabled={savingEdit || !editText.trim()}
                          className="rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-gray-950 transition hover:bg-yellow-300 active:scale-[0.98] disabled:opacity-40"
                        >
                          {savingEdit ? 'Сохраняю…' : 'Сохранить'}
                        </button>
                        <button type="button" onClick={cancelEdit} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-white">
                          Отмена
                        </button>
                        <span className="ml-auto hidden text-[11px] text-slate-600 sm:inline">{shortcut} — сохранить, Esc — отмена</span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-200 [overflow-wrap:anywhere]">{c.body}</p>
                  )}

                  {!editing && confirmId === c.id && (
                    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                      <span className="text-xs text-rose-200">{mine ? 'Удалить комментарий?' : 'Удалить комментарий коллеги?'}</span>
                      <button
                        type="button"
                        onClick={() => void remove(c)}
                        disabled={deletingId === c.id}
                        className="rounded-lg bg-rose-500/80 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                      >
                        {deletingId === c.id ? 'Удаляю…' : 'Удалить'}
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10">
                        Оставить
                      </button>
                    </div>
                  )}

                  {!editing && confirmId !== c.id && (
                    // С мышью — справа в строке имени и только при наведении (место под них не держим);
                    // на телефоне — всегда видны под текстом
                    <div className="mt-1 flex gap-3 text-xs transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:right-0 [@media(hover:hover)]:top-0 [@media(hover:hover)]:mt-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                      {mine && (
                        <button type="button" onClick={() => startEdit(c)} className="font-medium text-slate-500 transition hover:text-white">Изменить</button>
                      )}
                      <button type="button" onClick={() => { setEditingId(null); setConfirmId(c.id) }} className="font-medium text-slate-500 transition hover:text-rose-300">Удалить</button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* ── Новый комментарий ── */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 transition focus-within:border-yellow-400/40">
        <textarea
          ref={textRef}
          value={text}
          onChange={e => { setText(e.target.value); if (error) setError(null) }}
          onKeyDown={onComposerKey}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder="Комментарий для коллег…"
          aria-label="Новый комментарий"
          className="block w-full resize-none rounded-t-2xl bg-transparent px-4 pb-1 pt-3 text-base leading-relaxed text-white placeholder-slate-500 outline-none sm:text-sm"
        />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
          <AuthorBlock
            name={name}
            draft={nameDraft}
            editing={editingName || !name}
            hint={nameHint}
            inputRef={nameRef}
            onDraft={value => { setNameDraft(value); if (nameHint) setNameHint(false) }}
            onCommit={() => { if (nameDraft.trim()) saveName(nameDraft); else if (name) setEditingName(false) }}
            onStartEdit={() => { setNameDraft(name); setEditingName(true); window.setTimeout(() => nameRef.current?.select(), 0) }}
            onCancel={() => { setEditingName(false); setNameDraft('') }}
          />
          <div className="ml-auto flex items-center gap-3">
            {left <= 200 && <span className={`text-[11px] tabular-nums ${left <= 50 ? 'text-rose-300' : 'text-slate-500'}`}>{left}</span>}
            <span className="hidden text-[11px] text-slate-600 sm:inline">{shortcut}</span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="inline-flex items-center gap-1.5 rounded-xl bg-yellow-400 px-3.5 py-2 text-sm font-semibold text-gray-950 shadow-lg shadow-yellow-400/10 transition hover:bg-yellow-300 active:scale-[0.98] disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none"
            >
              {sending ? 'Отправляю…' : <>Отправить<SendIcon className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}

      {text.length === 0 && (
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden" aria-label="Быстрые фразы">
          {QUICK_PHRASES.map(phrase => (
            <button
              key={phrase}
              type="button"
              onClick={() => insertPhrase(phrase)}
              className="flex-shrink-0 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            >
              {phrase}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function AuthorBlock({
  name, draft, editing, hint, inputRef, onDraft, onCommit, onStartEdit, onCancel,
}: {
  name: string
  draft: string
  editing: boolean
  hint: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onDraft: (value: string) => void
  onCommit: () => void
  onStartEdit: () => void
  onCancel: () => void
}): ReactNode {
  if (editing) {
    return (
      <label className="flex min-w-0 items-center gap-2">
        <span className={`text-xs ${hint ? 'text-amber-300' : 'text-slate-500'}`}>{hint ? 'Подпишитесь:' : 'Ваше имя:'}</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => onDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit() }
            if (e.key === 'Escape' && name) { e.preventDefault(); e.stopPropagation(); onCancel() }
          }}
          onBlur={() => { if (draft.trim()) onCommit() }}
          maxLength={60}
          placeholder="например, Иван"
          aria-label="Как вас подписать"
          className={`w-40 min-w-0 rounded-lg border bg-white/5 px-2.5 py-1.5 text-base text-white placeholder-slate-600 outline-none transition sm:text-xs ${hint ? 'border-amber-400/60' : 'border-white/10 focus:border-yellow-400/50'}`}
        />
      </label>
    )
  }
  return (
    <button
      type="button"
      onClick={onStartEdit}
      title="Сменить подпись на этом устройстве"
      className="group/author flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-xs text-slate-400 transition hover:bg-white/5"
    >
      <StaffAvatar name={name} size="sm" />
      <span className="truncate"><span className="hidden sm:inline">Пишу как </span><span className="font-semibold text-slate-200">{name}</span></span>
      <span className="hidden text-slate-600 transition group-hover/author:text-slate-300 sm:inline">· сменить</span>
      <PencilIcon className="h-3 w-3 flex-shrink-0 text-slate-500 sm:hidden" />
    </button>
  )
}

/** Строка «последний комментарий» для карточки в списке заказов */
export function LastCommentLine({ preview, count, className = '' }: { preview?: OrderCommentPreview | null; count?: number; className?: string }) {
  if (!preview || !count) return null
  return (
    <div data-last-comment title={`${preview.author_name}: ${preview.body}`} className={`flex min-w-0 items-center gap-1.5 text-xs text-slate-400 ${className}`}>
      <CommentIcon className="h-3.5 w-3.5 flex-shrink-0 text-yellow-300/80" />
      {count > 1 && <span className="flex-shrink-0 rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">{count}</span>}
      <span className="flex-shrink-0 font-medium text-slate-300">{preview.author_name}:</span>
      <span className="min-w-0 truncate">{preview.body}</span>
    </div>
  )
}
