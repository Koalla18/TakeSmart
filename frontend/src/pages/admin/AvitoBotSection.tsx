import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY, SegmentedTabs } from './AdminShell'
import { call, copyText, type Api, type AuthFetch } from './installsApi'
import { BTN_ROW, CARD, INPUT, LABEL, Modal, Toggle } from './installsUi'

// ─────────────────────────────────────────────────────────────────────────────
// «Авито-бот». Вкладки: «Диалоги» (живые переписки, черновики, «нужен человек»),
// «Автоответы» (правила «ключевые слова → текст»), «Тест» (что бот ответит —
// без сохранения), «Настройки» (режим, имя, модель, ключи Авито).
// Бэкенд: /api/avito-bot/* (backend/src/app/api/routers/avito_bot.py).
// ─────────────────────────────────────────────────────────────────────────────

interface Rule {
  id: string
  keywords: string[]
  answer: string
  verbatim: boolean
  time_from: string
  time_to: string
  days: number[]
  delay_seconds: number
  max_per_chat: number
  is_active: boolean
  sort: number
  hits: number
}
type RuleDraft = Omit<Rule, 'id' | 'hits'>

interface Chat {
  id: string
  avito_chat_id: string
  is_simulated: boolean
  item_id: number | null
  order_number: string | null
  human_question: string | null
  opted_out: boolean
  client_name: string | null
  item_title: string | null
  item_price: string | null
  item_url: string | null
  mode: 'bot' | 'human'
  needs_human: boolean
  human_reason: string | null
  last_message_text: string | null
  last_message_at: string | null
  has_draft: boolean
}
interface OrderPayload { product_name: string; price: number; method: 'pickup' | 'delivery'; address: string; name: string; phone: string; email?: string; comment: string }
interface Message {
  id: string
  author: 'client' | 'bot' | 'staff' | 'system'
  text: string
  status: 'sent' | 'scheduled' | 'draft' | 'failed' | 'discarded'
  source: string | null
  error: string | null
  send_at: string | null
  attempts: number
  order_payload: OrderPayload | null
  created_at: string
}
interface CatalogProduct { id: string; name: string; price: number; stock_quantity: number; is_preorder: boolean }
interface ChatDetail extends Chat { messages: Message[]; linked_product: CatalogProduct | null; order_status: string | null }
interface Example { id: string; question: string; bot_answer: string | null; answer: string; item_title: string | null; chat_id: string | null; is_active: boolean; created_at: string }
interface Unanswered { chat_id: string; client_name: string | null; item_title: string | null; question: string; reason: string | null; at: string | null }
interface Health { last_webhook_at: string | null; last_poll_at: string | null; last_poll_error: string | null; caught_by_poll: number; llm_fail_streak: number; last_llm_error: string | null; queue_replies: number; queue_sends: number }
interface AudienceChat { id: string; client_name: string | null; item_title: string | null; last_message_text: string | null; last_message_at: string | null; order_number: string | null; is_simulated: boolean; last_broadcast_at: string | null }
interface Broadcast { id: string; title: string; text: string; status: 'draft' | 'sending' | 'paused' | 'done' | 'cancelled'; total: number; sent: number; failed: number; skipped: number; replied: number; created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null }
interface BroadcastDetail extends Broadcast { recipients: { chat_id: string; client_name: string | null; item_title: string | null; status: string; error: string | null; sent_at: string | null; replied: boolean }[] }
interface AnalyticsTop { label: string; count: number }
interface BotAnalytics {
  days: number; dialogs_new: number; dialogs_active: number; client_messages: number
  bot_replies: number; bot_by_rule: number; bot_by_llm: number; staff_replies: number
  auto_handled: number; handoffs: number; response_median_s: number | null; response_p90_s: number | null
  orders: number; orders_sum: number; reminders: number; reminders_replied: number; reminders_orders: number
  examples_learned: number; llm_calls: number; llm_errors: number; llm_tokens_in: number; llm_tokens_out: number; llm_cost: number | null
  series: { day: string; dialogs: number; bot_replies: number; staff_replies: number; orders: number }[]
  top_rules: AnalyticsTop[]; top_handoff_reasons: AnalyticsTop[]
}
interface Status { enabled: boolean; llm_ready: boolean; avito_connected: boolean; health: Health }
interface ChatsResponse { chats: Chat[]; total: number; needs_human: number; drafts: number }

interface Config {
  enabled: boolean
  mode: 'draft' | 'auto'
  persona_name: string
  greeting: string
  first_message: string
  price_list: string
  trade_in_prices: string
  staff_takes_over: boolean
  human_mode: boolean
  allow_emoji: boolean
  off_topic_silent: boolean
  style: string
  knowledge: string
  handoff_topics: string
  handoff_message: string
  reply_delay_min: number
  reply_delay_max: number
  use_catalog: boolean
  orders_enabled: boolean
  pickup_address: string
  system_patterns: string
  reminders_enabled: boolean
  reminder_after_minutes: number
  reminder_window_hours: number
  reminder_from: string
  reminder_to: string
  reminder_use_llm: boolean
  reminder_template: string
  llm_price_in: number
  llm_price_out: number
  broadcast_interval_seconds: number
  llm_provider: 'none' | 'yandex' | 'deepseek' | 'qwen' | 'timeweb' | 'openai_compatible'
  llm_base_url: string
  llm_model: string
  llm_folder_id: string
  llm_temperature: number
  llm_api_key_set: boolean
  avito_client_id: string
  avito_client_secret_set: boolean
  avito_user_id: number | null
  avito_connected_at: string | null
  webhook_url: string | null
}
interface Decision {
  action: 'reply' | 'handoff' | 'silent'
  text: string | null
  source: string | null
  rule_id: string | null
  reason: string | null
  delay_seconds: number
  catalog: string[]
  order: OrderPayload | null
  examples_used: number
  first_message: string | null
}

type View = 'dialogs' | 'broadcasts' | 'analytics' | 'prices' | 'rules' | 'learning' | 'test' | 'settings'
const VIEWS: readonly View[] = ['dialogs', 'broadcasts', 'analytics', 'prices', 'rules', 'learning', 'test', 'settings']
type ChatFilter = 'all' | 'human' | 'draft' | 'test'
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const NEW_RULE: RuleDraft = { keywords: [], answer: '', verbatim: true, time_from: '00:00', time_to: '23:59', days: ALL_DAYS, delay_seconds: 2, max_per_chat: 1, is_active: true, sort: 0 }

function timeShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function ago(iso: string | null): string {
  if (!iso) return 'ещё не было'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.round(s / 60)} мин назад`
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Ник покупателя из Авито; пока Авито его не отдал — понятная подпись с хвостом номера чата */
function clientLabel(c: { client_name: string | null; is_simulated?: boolean; avito_chat_id?: string }): string {
  if (c.client_name) return c.client_name
  if (c.is_simulated) return 'Тестовый покупатель'
  return c.avito_chat_id ? `Покупатель с Авито · …${c.avito_chat_id.slice(-4)}` : 'Покупатель с Авито'
}

function orderText(o: OrderPayload): string {
  const how = o.method === 'delivery' ? `доставка: ${o.address}` : 'самовывоз'
  return [o.product_name, `${Math.round(o.price).toLocaleString('ru-RU')} ₽`, how, o.name, o.phone, o.email].filter(Boolean).join(' · ')
}

function scheduleText(r: Pick<Rule, 'time_from' | 'time_to' | 'days'>): string {
  const time = r.time_from === '00:00' && r.time_to === '23:59' ? 'круглосуточно' : `${r.time_from}–${r.time_to}`
  const days = r.days.length === 7 ? '' : ` · ${r.days.map(d => DAYS[d]).join(' ')}`
  return time + days
}

// ── Раздел ───────────────────────────────────────────────────────────────────

export function AvitoBotSection({ authFetch }: { authFetch: AuthFetch }) {
  const api = useCallback<Api>((path, init) => authFetch(`${API_BASE_URL}/api/avito-bot${path}`, init), [authFetch])
  const [params, setParams] = useSearchParams()
  const [config, setConfig] = useState<Config | null>(null)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [counts, setCounts] = useState<{ needs_human: number; drafts: number } | null>(null)

  const loadConfig = useCallback(async () => { const c = await call<Config>(api, '/settings'); if (c) setConfig(c) }, [api])
  const loadRules = useCallback(async () => { const r = await call<Rule[]>(api, '/rules'); if (r) setRules(r) }, [api])
  useEffect(() => {
    const t = window.setTimeout(() => { loadConfig(); loadRules() }, 0)
    return () => window.clearTimeout(t)
  }, [loadConfig, loadRules])

  const chatParam = params.get('chat')
  const viewParam = params.get('view') as View | null
  const view: View = chatParam ? 'dialogs' : viewParam && VIEWS.includes(viewParam) ? viewParam : 'dialogs'
  const patchParams = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
      return next
    }, { replace: true })
  }, [setParams])

  const attention = (counts?.needs_human || 0) + (counts?.drafts || 0)
  const notReady = config && (!config.enabled || config.llm_provider === 'none' || !config.avito_connected_at)

  return (
    <div data-avito-root data-view={view}>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs<View>
          items={[
            { id: 'dialogs', label: 'Диалоги', count: attention || undefined },
            { id: 'broadcasts', label: 'Рассылки' },
            { id: 'analytics', label: 'Аналитика' },
            { id: 'prices', label: 'Прайс' },
            { id: 'rules', label: 'Автоответы', count: rules?.length || undefined },
            { id: 'learning', label: 'Обучение' },
            { id: 'test', label: 'Тест' },
            { id: 'settings', label: notReady ? 'Настройки •' : 'Настройки' },
          ]}
          value={view}
          onChange={v => patchParams({ view: v, chat: null })}
        />
        {config && <StatusPill config={config} />}
      </div>

      {view === 'dialogs' && <DialogsTab api={api} config={config} openChatId={chatParam} onOpen={id => patchParams({ view: 'dialogs', chat: id })} onCounts={setCounts} />}
      {view === 'rules' && <RulesTab api={api} rules={rules} reload={loadRules} />}
      {view === 'broadcasts' && <BroadcastsTab api={api} config={config} onOpenChat={id => patchParams({ view: 'dialogs', chat: id })} />}
      {view === 'analytics' && <BotAnalyticsTab api={api} />}
      {view === 'prices' && (config ? <PriceListTab api={api} config={config} setConfig={setConfig} /> : <Loading />)}
      {view === 'learning' && <LearningTab api={api} reloadRules={loadRules} onOpenChat={id => patchParams({ view: 'dialogs', chat: id })} />}
      {view === 'test' && <TestTab api={api} rules={rules} />}
      {view === 'settings' && (config ? <SettingsTab api={api} config={config} setConfig={setConfig} /> : <Loading />)}
    </div>
  )
}

function Loading() {
  return <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем…</div>
}

function StatusPill({ config }: { config: Config }) {
  const [dot, text] = !config.enabled
    ? ['bg-slate-500', 'Бот выключен']
    : !config.avito_connected_at
      ? ['bg-amber-400', 'Включён · Авито не подключён']
      : config.mode === 'draft'
        ? ['bg-emerald-400', 'Работает · черновики']
        : ['bg-emerald-400', 'Работает · отвечает сам']
  return (
    <span className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
      <span className={`h-2 w-2 rounded-full ${dot}`} />{text}
    </span>
  )
}

// ── Диалоги ──────────────────────────────────────────────────────────────────

const CHATS_POLL_MS = 4000

function DialogsTab({ api, config, openChatId, onOpen, onCounts }: {
  api: Api
  config: Config | null
  openChatId: string | null
  onOpen: (id: string | null) => void
  onCounts: (c: { needs_human: number; drafts: number }) => void
}) {
  const [filter, setFilter] = useState<ChatFilter>('all')
  const [data, setData] = useState<ChatsResponse | null>(null)
  const [simOpen, setSimOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api(`/chats?filter=${filter}`)
      if (!res.ok) return
      const d: ChatsResponse = await res.json()
      setData(d)
      onCounts({ needs_human: d.needs_human, drafts: d.drafts })
    } catch { /* сеть */ }
  }, [api, filter, onCounts])
  useEffect(() => {
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(() => { if (!document.hidden) load() }, CHATS_POLL_MS)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [load])

  const filters: { id: ChatFilter; label: string; count?: number; tone?: string }[] = [
    { id: 'all', label: 'Все', count: data?.total },
    { id: 'human', label: 'Нужен человек', count: data?.needs_human, tone: 'text-amber-300' },
    { id: 'draft', label: 'Черновики', count: data?.drafts, tone: 'text-sky-300' },
    { id: 'test', label: 'Тренировочные' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`${CARD} !p-0 overflow-hidden ${openChatId ? 'hidden lg:block' : ''}`}>
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] p-3">
          {filters.map(f => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${filter === f.id ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:bg-white/[0.06]'}`}>
              {f.label}{f.count ? <span className={`ml-1.5 tabular-nums ${f.tone || 'text-slate-500'}`}>{f.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="max-h-[64vh] overflow-y-auto">
          {data === null ? <div className="p-4 text-sm text-slate-500">Загружаем…</div>
            : data.chats.length === 0 ? (
              <div className="p-5 text-sm text-slate-400">
                {filter === 'all'
                  ? <>Диалогов пока нет. Они появятся, когда Авито будет подключён в настройках. А пока напишите боту сами — как покупатель.</>
                  : 'Здесь пусто.'}
              </div>
            ) : data.chats.map(c => (
              <button key={c.id} type="button" onClick={() => onOpen(c.id)}
                className={`block w-full border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04] ${openChatId === c.id ? 'bg-white/[0.07]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">{clientLabel(c)}</span>
                  {c.needs_human ? <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-300">человек</span>
                    : c.has_draft ? <span className="shrink-0 rounded-md bg-sky-400/15 px-1.5 py-0.5 text-[11px] text-sky-300">черновик</span>
                      : <span className="shrink-0 text-[11px] text-slate-500">{timeShort(c.last_message_at)}</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {c.is_simulated && <span className="mr-1 text-violet-300">тест ·</span>}
                  {c.item_title ? `${c.item_title} · ` : ''}{c.last_message_text}
                </div>
              </button>
            ))}
        </div>
        <div className="border-t border-white/[0.06] p-3">
          <button type="button" onClick={() => setSimOpen(true)} className={`${BTN_ROW} w-full`}>Написать боту как покупатель</button>
        </div>
      </div>

      {openChatId
        ? <ChatPanel key={openChatId} api={api} chatId={openChatId} config={config} onClose={() => onOpen(null)} onChanged={load} />
        : <div className={`${CARD} hidden items-center justify-center text-sm text-slate-500 lg:flex`}>Выберите диалог слева</div>}

      {simOpen && (
        <SimulateModal api={api} onClose={() => setSimOpen(false)} onCreated={id => { setSimOpen(false); setFilter('all'); load(); onOpen(id) }} />
      )}
    </div>
  )
}

function SimulateModal({ api, onClose, onCreated }: { api: Api; onClose: () => void; onCreated: (id: string) => void }) {
  const [item, setItem] = useState('iPhone 17 Pro 256 ГБ')
  const [price, setPrice] = useState('')
  const [text, setText] = useState('Здравствуйте! Цена актуальная?')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!text.trim()) return toast('Напишите сообщение', 'error')
    setBusy(true)
    const chat = await call<Chat>(api, '/simulate', { method: 'POST', body: { text, item_title: item || null, item_price: price || null } })
    setBusy(false)
    if (chat) onCreated(chat.id)
  }
  return (
    <Modal title="Тренировочный диалог" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-400">Бот ответит как в настоящем чате Авито, но в Авито ничего не уйдёт. Удобно проверять автоответы и тон.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <label className="block"><span className={LABEL}>Объявление</span><input className={`${INPUT} mt-1.5`} value={item} onChange={e => setItem(e.target.value)} placeholder="iPhone 17 Pro 256 ГБ" /></label>
        <label className="block"><span className={LABEL}>Цена</span><input className={`${INPUT} mt-1.5`} value={price} onChange={e => setPrice(e.target.value)} placeholder="135 990 ₽" /></label>
      </div>
      <label className="mt-3 block"><span className={LABEL}>Сообщение покупателя</span><textarea className={`${INPUT} mt-1.5 h-24`} value={text} onChange={e => setText(e.target.value)} /></label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
        <button type="button" onClick={submit} disabled={busy} className={BTN_PRIMARY}>Написать</button>
      </div>
    </Modal>
  )
}

const CHAT_POLL_MS = 3000

function ChatPanel({ api, chatId, config, onClose, onChanged }: { api: Api; chatId: string; config: Config | null; onClose: () => void; onChanged: () => void }) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await api(`/chats/${chatId}`)
      if (res.status === 404) { toast('Диалог не найден', 'error'); onClose(); return }
      if (res.ok) setChat(await res.json())
    } catch { /* сеть */ }
  }, [api, chatId, onClose])
  useEffect(() => {
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(() => { if (!document.hidden) load() }, CHAT_POLL_MS)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [load])
  useEffect(() => {
    const n = chat?.messages.length || 0
    if (n !== lastCount.current) { lastCount.current = n; bottom.current?.scrollIntoView({ block: 'nearest' }) }
  }, [chat])

  const act = async (path: string, body?: unknown, ok?: string) => {
    setBusy(true)
    const res = await call(api, path, { method: 'POST', body: body ?? {} })
    setBusy(false)
    if (res !== null) { if (ok) toast(ok, 'success'); load(); onChanged() }
    return res !== null
  }
  const send = async () => {
    const t = text.trim()
    if (!t) return
    const ok = chat?.is_simulated
      ? await act('/simulate', { chat_id: chatId, text: t })
      : await act(`/chats/${chatId}/send`, { text: t })
    if (ok) setText('')
  }
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Удалить тренировочный диалог?', message: 'Переписка удалится вместе с черновиками.', confirmLabel: 'Удалить', danger: true }))) return
    const res = await call(api, `/chats/${chatId}`, { method: 'DELETE' })
    if (res !== null) { onChanged(); onClose() }
  }

  if (!chat) return <div className={CARD}><Loading /></div>
  const name = config?.persona_name || 'Бот'

  return (
    <div className={`${CARD} flex min-h-[60vh] flex-col !p-0`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="min-w-0">
          <button type="button" onClick={onClose} className="mb-1 text-xs text-slate-500 hover:text-slate-300 lg:hidden">← Все диалоги</button>
          <div className="truncate font-semibold text-white">
            {chat.item_url ? <a href={chat.item_url} target="_blank" rel="noreferrer" className="hover:underline">{chat.item_title}</a> : chat.item_title || 'Объявление ещё не определено'}
          </div>
          <div className="text-xs text-slate-400">
            {clientLabel(chat)}{chat.item_price ? ` · в объявлении ${chat.item_price}` : ''}{chat.is_simulated ? ' · тренировочный' : ''}
          </div>
          {chat.item_id ? (
            <button type="button" onClick={() => setLinkOpen(true)} className="mt-1 text-xs text-slate-500 hover:text-slate-300">
              {chat.linked_product
                ? <>Товар каталога: <span className="text-slate-300">{chat.linked_product.name}</span> · {Math.round(chat.linked_product.price).toLocaleString('ru-RU')} ₽ · {chat.linked_product.is_preorder ? 'предзаказ' : `${chat.linked_product.stock_quantity} шт.`} — изменить</>
                : <span className="underline decoration-dotted">Привязать объявление к товару каталога — для точной цены и наличия</span>}
            </button>
          ) : null}
          <button type="button" onClick={() => act(`/chats/${chatId}/opt-out`, { value: !chat.opted_out }, chat.opted_out ? 'Рассылки снова разрешены' : 'Рассылки этому покупателю отключены')}
            className={`mt-1.5 mr-2 inline-flex rounded-lg px-2 py-0.5 text-xs transition ${chat.opted_out ? 'bg-rose-400/15 text-rose-300 hover:bg-rose-400/25' : 'bg-white/[0.06] text-slate-400 hover:bg-white/[0.1]'}`}>
            {chat.opted_out ? 'Не присылать рассылки ✓' : 'Рассылки: можно'}
          </button>
          {chat.order_number && (
            <a href={`/admin?tab=orders&q=${encodeURIComponent(chat.order_number)}`}
              className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs ${chat.order_status === 'cancelled' ? 'bg-rose-400/15 text-rose-300 hover:bg-rose-400/25' : 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25'}`}>
              {chat.order_status === 'cancelled' ? `Заявка ${chat.order_number} отменена покупателем` : `Заявка оформлена · заказ ${chat.order_number}`}
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {chat.mode === 'bot'
            ? <button type="button" disabled={busy} onClick={() => act(`/chats/${chatId}/take`, undefined, 'Диалог ваш — бот молчит')} className={BTN_ROW}>Взять диалог</button>
            : <button type="button" disabled={busy} onClick={() => act(`/chats/${chatId}/release`, undefined, 'Бот снова отвечает')} className={BTN_ROW}>Вернуть боту</button>}
          {chat.needs_human && chat.mode === 'bot' && (
            <button type="button" disabled={busy} onClick={() => act(`/chats/${chatId}/release`, undefined, 'Готово')} className={BTN_ROW}>Решено, бот продолжает</button>
          )}
          {chat.is_simulated && <button type="button" onClick={remove} className={BTN_ROW} aria-label="Удалить диалог"><AdminIcon name="trash" className="h-4 w-4" /></button>}
        </div>
      </div>

      {chat.needs_human && (
        <div className="border-b border-amber-400/20 bg-amber-400/[0.08] px-5 py-2 text-sm text-amber-200">
          Нужен человек: {chat.human_reason || 'бот не уверен'}. Бот в этом диалоге молчит, пока вы не ответите или не отметите «решено».
        </div>
      )}
      {chat.mode === 'human' && !chat.needs_human && (
        <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-2 text-sm text-slate-400">Диалог ведёт сотрудник — бот не отвечает.</div>
      )}

      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4" style={{ maxHeight: '56vh' }}>
        {chat.messages.map(m => <Bubble key={m.id} m={m} name={name} api={api} onDone={() => { load(); onChanged() }} />)}
        <div ref={bottom} />
      </div>

      {linkOpen && chat.item_id && (
        <LinkProductModal api={api} itemId={chat.item_id} itemTitle={chat.item_title} current={chat.linked_product}
          onClose={() => setLinkOpen(false)} onDone={() => { setLinkOpen(false); load() }} />
      )}

      <div className="flex gap-2 border-t border-white/[0.06] p-3">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={chat.is_simulated ? 'Написать как покупатель' : 'Ответить от себя — бот в этом диалоге замолчит'}
          className={`${INPUT} min-h-[44px] resize-none`} />
        <button type="button" onClick={send} disabled={busy || !text.trim()} className={BTN_PRIMARY} aria-label="Отправить"><AdminIcon name="send" className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<string, string> = { rule: 'автоответ', llm: 'модель', staff: 'сотрудник', avito: 'из приложения Авито', reminder: 'напоминание', broadcast: 'рассылка' }

function Bubble({ m, name, api, onDone }: { m: Message; name: string; api: Api; onDone: () => void }) {
  if (m.author === 'system') {
    return (
      <div className="mx-auto max-w-[90%] rounded-xl bg-white/[0.04] px-3 py-1.5 text-center text-[12px] text-slate-500" title="Системное сообщение Авито — бот на него не отвечает">
        Авито: {m.text}
      </div>
    )
  }
  return <ChatBubble m={m} name={name} api={api} onDone={onDone} />
}

function ChatBubble({ m, name, api, onDone }: { m: Message; name: string; api: Api; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const mine = m.author !== 'client'
  const who = m.author === 'client' ? null : m.author === 'bot' ? name : 'Сотрудник'
  const meta = [who, m.source ? SOURCE_LABEL[m.source] : null, timeShort(m.created_at)].filter(Boolean).join(' · ')

  const run = async (path: string, body: unknown) => {
    setBusy(true)
    const res = await call(api, path, { method: 'POST', body })
    setBusy(false)
    if (res !== null) { setEditing(false); onDone() }
  }

  if (m.status === 'scheduled') {
    const at = m.send_at ? new Date(m.send_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl border border-dashed border-white/20 p-3">
        <div className="mb-1 text-[11px] text-slate-400">
          {m.attempts ? `Не ушло, повтор ${m.attempts + 1} в ${at}` : `Отправится в ${at}`} · {meta}
        </div>
        <div className="whitespace-pre-wrap text-sm text-slate-200">{m.text}</div>
        {m.order_payload && <div className="mt-1.5 text-xs text-emerald-300">Оформит бронь: {orderText(m.order_payload)}</div>}
        {m.error && <div className="mt-1 text-xs text-rose-300">{m.error}</div>}
        <button type="button" disabled={busy} onClick={() => run(`/messages/${m.id}/discard`, {})} className={`${BTN_ROW} mt-2`}>Не отправлять</button>
      </div>
    )
  }
  if (m.status === 'draft') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl border border-dashed border-sky-400/40 bg-sky-400/[0.06] p-3">
        <div className="mb-1 text-[11px] text-sky-300">Черновик · {meta}</div>
        {editing
          ? <textarea className={`${INPUT} h-24`} value={text} onChange={e => setText(e.target.value)} />
          : <div className="whitespace-pre-wrap text-sm text-slate-100">{m.text}</div>}
        {m.order_payload && <div className="mt-1.5 rounded-lg bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">После отправки оформится бронь: {orderText(m.order_payload)}</div>}
        {m.error && <div className="mt-1 text-xs text-rose-300">{m.error}</div>}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run(`/messages/${m.id}/approve`, editing ? { text } : {})} className={`${BTN_PRIMARY} !px-3 !py-1.5`}>Отправить</button>
          {!editing && <button type="button" onClick={() => setEditing(true)} className={BTN_ROW}>Изменить</button>}
          {editing && <span className="self-center text-[11px] text-slate-500">Ваш вариант запомнится — бот будет отвечать так в похожих случаях</span>}
          <button type="button" disabled={busy} onClick={() => run(`/messages/${m.id}/discard`, {})} className={BTN_ROW}>Не отвечать</button>
        </div>
      </div>
    )
  }
  return (
    <div className={`max-w-[80%] ${mine ? 'ml-auto text-right' : ''}`}>
      <div className={`inline-block whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${mine ? (m.author === 'bot' ? 'bg-yellow-400/[0.14] text-yellow-50' : 'bg-white/[0.12] text-white') : 'bg-white/[0.06] text-slate-100'}`}>
        {m.text}
      </div>
      {(meta || m.status === 'failed') && (
        <div className={`mt-0.5 text-[11px] ${m.status === 'failed' ? 'text-rose-300' : 'text-slate-500'}`}>
          {m.status === 'failed' ? `Не отправлено: ${m.error || 'ошибка'}` : meta}
        </div>
      )}
    </div>
  )
}

function LinkProductModal({ api, itemId, itemTitle, current, onClose, onDone }: {
  api: Api; itemId: number; itemTitle: string | null; current: CatalogProduct | null; onClose: () => void; onDone: () => void
}) {
  const [q, setQ] = useState(itemTitle || '')
  const [hits, setHits] = useState<CatalogProduct[] | null>(null)
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) return
    const t = window.setTimeout(async () => {
      setHits(await call<CatalogProduct[]>(api, `/products?q=${encodeURIComponent(query)}`) ?? [])
    }, 250)
    return () => window.clearTimeout(t)
  }, [api, q])
  const link = async (p: CatalogProduct) => {
    if (await call(api, `/items/${itemId}/link`, { method: 'PUT', body: { product_id: p.id } }) !== null) { toast('Объявление привязано', 'success'); onDone() }
  }
  const unlink = async () => {
    if (await call(api, `/items/${itemId}/link`, { method: 'DELETE' }) !== null) { toast('Привязка снята', 'success'); onDone() }
  }
  return (
    <Modal title="Товар для объявления" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-400">Бот будет брать цену и наличие из этой карточки во всех диалогах по объявлению «{itemTitle || itemId}».</p>
      <input className={INPUT} value={q} onChange={e => setQ(e.target.value)} placeholder="iPhone 17 Pro 256" autoFocus />
      <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
        {hits === null ? null : hits.length === 0 ? <div className="text-sm text-slate-500">Ничего не нашлось</div> : hits.map(p => (
          <button key={p.id} type="button" onClick={() => link(p)}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition hover:bg-white/[0.05] ${current?.id === p.id ? 'border-yellow-400/50' : 'border-white/10'}`}>
            <span className="text-white">{p.name}</span>
            <span className="shrink-0 text-xs text-slate-400">{Math.round(p.price).toLocaleString('ru-RU')} ₽ · {p.is_preorder ? 'предзаказ' : `${p.stock_quantity} шт.`}</span>
          </button>
        ))}
      </div>
      {current && <button type="button" onClick={unlink} className={`${BTN_ROW} mt-4`}>Снять привязку</button>}
    </Modal>
  )
}

// ── Рассылки ─────────────────────────────────────────────────────────────────

const BC_STATUS: Record<Broadcast['status'], { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'bg-white/10 text-slate-300' },
  sending: { label: 'Идёт', cls: 'bg-emerald-400/15 text-emerald-300' },
  paused: { label: 'На паузе', cls: 'bg-amber-400/15 text-amber-300' },
  done: { label: 'Завершена', cls: 'bg-sky-400/15 text-sky-300' },
  cancelled: { label: 'Отменена', cls: 'bg-white/10 text-slate-500' },
}

function BroadcastsTab({ api, config, onOpenChat }: { api: Api; config: Config | null; onOpenChat: (id: string) => void }) {
  const [list, setList] = useState<Broadcast[] | null>(null)
  const [composing, setComposing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r = await api('/broadcasts'); if (r.ok) setList(await r.json()) } catch { /* сеть */ }
  }, [api])
  const sending = (list || []).some(b => b.status === 'sending')
  useEffect(() => {
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(() => { if (!document.hidden) load() }, sending ? 3000 : 15000)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [load, sending])

  const action = async (b: Broadcast, act: 'start' | 'pause' | 'cancel') => {
    if (act === 'cancel' && !(await confirmDialog({ title: 'Отменить рассылку?', message: 'Тем, кому ещё не отправлено, сообщение не уйдёт.', confirmLabel: 'Отменить рассылку', danger: true }))) return
    if (await call(api, `/broadcasts/${b.id}/${act}`, { method: 'POST' }) !== null) load()
  }
  const remove = async (b: Broadcast) => {
    if (!(await confirmDialog({ title: 'Удалить рассылку?', message: 'Отправленные сообщения останутся в диалогах.', confirmLabel: 'Удалить', danger: true }))) return
    if (await call(api, `/broadcasts/${b.id}`, { method: 'DELETE' }) !== null) load()
  }

  return (
    <div className="space-y-4">
      <div className={`${CARD} text-sm text-slate-400`}>
        Рассылка уходит только тем, кто уже писал вам на Авито — API не позволяет писать первым. Кто попросил не писать («не пишите», «стоп», «спам»),
        исключается автоматически. Сообщения идут по одному с паузой {config?.broadcast_interval_seconds ?? 6} с. Ответы покупателей подхватывает бот, как обычно.
      </div>
      {!composing && (
        <button type="button" onClick={() => setComposing(true)} className={BTN_PRIMARY}><AdminIcon name="plus" className="h-4 w-4" />Новая рассылка</button>
      )}
      {composing && <BroadcastComposer api={api} config={config} onClose={() => setComposing(false)} onCreated={() => { setComposing(false); load() }} />}

      {list === null ? <Loading /> : list.length === 0 ? (
        !composing && <div className={`${CARD} text-sm text-slate-400`}>Рассылок пока не было.</div>
      ) : (
        <div className="space-y-3">
          {list.map(b => {
            const done = b.sent + b.failed + b.skipped
            const st = BC_STATUS[b.status]
            return (
              <div key={b.id} className={CARD}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{b.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm text-slate-400">{b.text}</div>
                    <div className="mt-1 text-xs text-slate-500">{[b.created_by, timeShort(b.created_at)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(b.status === 'draft' || b.status === 'paused') && <button type="button" onClick={() => action(b, 'start')} className={BTN_ROW}>{b.status === 'draft' ? 'Запустить' : 'Продолжить'}</button>}
                    {b.status === 'sending' && <button type="button" onClick={() => action(b, 'pause')} className={BTN_ROW}>Пауза</button>}
                    {(b.status === 'sending' || b.status === 'paused' || b.status === 'draft') && <button type="button" onClick={() => action(b, 'cancel')} className={BTN_ROW}>Отменить</button>}
                    {(b.status === 'done' || b.status === 'cancelled' || b.status === 'draft') && <button type="button" onClick={() => remove(b)} className={`${BTN_ROW} text-rose-300`} aria-label="Удалить"><AdminIcon name="trash" className="h-4 w-4" /></button>}
                    <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className={BTN_ROW}>{open === b.id ? 'Скрыть' : 'Получатели'}</button>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${b.total ? (done / b.total) * 100 : 0}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>отправлено {b.sent} из {b.total}</span>
                  {b.failed > 0 && <span className="text-rose-300">не ушло {b.failed}</span>}
                  {b.skipped > 0 && <span>пропущено {b.skipped}</span>}
                  <span className="text-emerald-300">ответили {b.replied}{b.sent ? ` (${Math.round((b.replied / b.sent) * 100)}%)` : ''}</span>
                </div>
                {open === b.id && <BroadcastRecipients api={api} id={b.id} onOpenChat={onOpenChat} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const RCP_STATUS: Record<string, string> = { pending: 'в очереди', sent: 'отправлено', failed: 'не ушло', skipped: 'пропущено' }

function BroadcastRecipients({ api, id, onOpenChat }: { api: Api; id: string; onOpenChat: (id: string) => void }) {
  const [d, setD] = useState<BroadcastDetail | null>(null)
  useEffect(() => { call<BroadcastDetail>(api, `/broadcasts/${id}`).then(setD) }, [api, id])
  if (!d) return <div className="mt-3 text-sm text-slate-500">Загружаем…</div>
  return (
    <div className="mt-3 max-h-72 divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-white/[0.06]">
      {d.recipients.map(r => (
        <button key={r.chat_id} type="button" onClick={() => onOpenChat(r.chat_id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/[0.04]">
          <span className="min-w-0 truncate text-slate-200">{r.client_name || 'Покупатель с Авито'} <span className="text-slate-500">· {r.item_title}</span></span>
          <span className={`shrink-0 text-xs ${r.status === 'failed' ? 'text-rose-300' : r.replied ? 'text-emerald-300' : 'text-slate-500'}`} title={r.error || ''}>
            {r.replied ? 'ответил' : RCP_STATUS[r.status] || r.status}
          </span>
        </button>
      ))}
    </div>
  )
}

function BroadcastComposer({ api, config, onClose, onCreated }: { api: Api; config: Config | null; onClose: () => void; onCreated: () => void }) {
  const [days, setDays] = useState(30)
  const [q, setQ] = useState('')
  const [hasOrder, setHasOrder] = useState<'any' | 'yes' | 'no'>('any')
  const [skipRecent, setSkipRecent] = useState(7)
  const [includeTest, setIncludeTest] = useState(false)
  const [aud, setAud] = useState<{ chats: AudienceChat[]; total: number; opted_out: number } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [text, setText] = useState('Здравствуйте, {name}! ')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const params = new URLSearchParams({ days: String(days), has_order: hasOrder, skip_recent_days: String(skipRecent), include_test: String(includeTest) })
      if (q.trim()) params.set('q', q.trim())
      const r = await call<{ chats: AudienceChat[]; total: number; opted_out: number }>(api, `/audience?${params}`)
      if (r) { setAud(r); setSelected(new Set(r.chats.map(c => c.id))) }
    }, 300)
    return () => window.clearTimeout(t)
  }, [api, days, q, hasOrder, skipRecent, includeTest])

  const firstSelected = aud?.chats.find(c => selected.has(c.id))?.id
  useEffect(() => {
    if (!text.trim()) return
    const t = window.setTimeout(async () => {
      const r = await call<{ text: string }>(api, '/broadcasts-preview', { method: 'POST', body: { text, chat_id: firstSelected ?? null } })
      if (r) setPreview(r.text)
    }, 300)
    return () => window.clearTimeout(t)
  }, [api, text, firstSelected])

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const create = async (start: boolean) => {
    if (!selected.size) return toast('Выберите получателей', 'error')
    if (!text.trim() || text.trim() === 'Здравствуйте, {name}!') return toast('Напишите текст рассылки', 'error')
    if (start) {
      const minutes = Math.ceil((selected.size * (config?.broadcast_interval_seconds ?? 6)) / 60)
      if (!(await confirmDialog({ title: `Отправить ${selected.size} покупателям?`, message: `Сообщения уйдут по одному, это займёт около ${minutes} мин. Рассылку можно поставить на паузу.`, confirmLabel: 'Отправить' }))) return
    }
    setBusy(true)
    const r = await call(api, '/broadcasts', { method: 'POST', body: { title, text, chat_ids: [...selected], start } })
    setBusy(false)
    if (r !== null) { toast(start ? 'Рассылка запущена' : 'Черновик сохранён', 'success'); onCreated() }
  }

  const sel = 'rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white focus:outline-none'
  return (
    <div className={`${CARD} space-y-4`}>
      <div className="flex items-center justify-between"><h3 className="font-semibold text-white">Новая рассылка</h3>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><AdminIcon name="x" className="h-5 w-5" /></button></div>

      <div>
        <span className={LABEL}>Кому</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <select className={sel} value={days} onChange={e => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map(d => <option key={d} value={d}>писали за {d} дн.</option>)}
          </select>
          <select className={sel} value={hasOrder} onChange={e => setHasOrder(e.target.value as 'any' | 'yes' | 'no')}>
            <option value="any">с бронью и без</option><option value="no">без брони</option><option value="yes">только с бронью</option>
          </select>
          <select className={sel} value={skipRecent} onChange={e => setSkipRecent(Number(e.target.value))}>
            <option value={0}>получавшим рассылку — тоже</option><option value={3}>кроме получавших за 3 дн.</option>
            <option value={7}>кроме получавших за 7 дн.</option><option value={30}>кроме получавших за 30 дн.</option>
          </select>
          <input className={`${INPUT} !w-56`} value={q} onChange={e => setQ(e.target.value)} placeholder="Имя или объявление: iphone" />
          <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={includeTest} onChange={e => setIncludeTest(e.target.checked)} />тренировочные</label>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2 text-sm">
          <span className="text-slate-300">Выбрано {selected.size} из {aud?.total ?? '…'}{aud?.opted_out ? <span className="text-slate-500"> · ещё {aud.opted_out} просили не писать — исключены</span> : null}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set(aud?.chats.map(c => c.id)))} className="text-xs text-slate-400 hover:text-white">все</button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-white">никого</button>
          </span>
        </div>
        <div className="max-h-72 divide-y divide-white/[0.04] overflow-y-auto">
          {aud === null ? <div className="p-3 text-sm text-slate-500">Загружаем…</div>
            : aud.chats.length === 0 ? <div className="p-3 text-sm text-slate-500">Под условия никто не подходит</div>
              : aud.chats.map(c => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-white/[0.03]">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-yellow-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{clientLabel(c)}{c.is_simulated && <span className="ml-1 text-violet-300">тест</span>}{c.order_number && <span className="ml-1.5 text-xs text-emerald-300">бронь {c.order_number}</span>}</span>
                    <span className="block truncate text-xs text-slate-500">{c.item_title}{c.last_message_text ? ` · ${c.last_message_text}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">{timeShort(c.last_message_at)}</span>
                </label>
              ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block"><span className={LABEL}>Название (видно только вам)</span><input className={`${INPUT} mt-1.5`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Скидка на iPhone 17 Pro" /></label>
          <label className="block"><span className={LABEL}>Текст</span><textarea className={`${INPUT} mt-1.5 h-32`} value={text} onChange={e => setText(e.target.value)} /></label>
          <div className="text-xs text-slate-500"><code className="text-slate-300">{'{name}'}</code> — имя покупателя, <code className="text-slate-300">{'{item}'}</code> — объявление, по которому он писал. Пишите по-человечески и по делу — без капса и восклицательных гирлянд.</div>
        </div>
        <div>
          <span className={LABEL}>Так увидит {aud?.chats.find(c => c.id === firstSelected)?.client_name || 'покупатель'}</span>
          <div className="mt-1.5 rounded-2xl bg-white/[0.06] p-3 text-sm whitespace-pre-wrap text-slate-100">{preview || '—'}</div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => create(false)} disabled={busy} className={BTN_SECONDARY}>Сохранить черновик</button>
        <button type="button" onClick={() => create(true)} disabled={busy} className={BTN_PRIMARY}>Отправить {selected.size || ''}</button>
      </div>
    </div>
  )
}

// ── Прайс ────────────────────────────────────────────────────────────────────

const PRICE_EXAMPLE = `ПРАЙС iPhone 17 TakeSmart, [24 ноя. 2026 в 11:02]
16 128 Teal 🇮🇳 - 59.700
17Pro 256 Orange -     94000🇰🇷1SIM.
17Pro 256 Orange -     91500🇯🇵eSIM.
17 Pro Max 2TB Orange 1Sim 🇭🇰 - 156.000

# можно и таблицей: Модель; Память; Цвет; Цена; Наличие
Galaxy Z Fold8; 12/256; Серый; 118990`

function PriceListTab({ api, config, setConfig }: { api: Api; config: Config; setConfig: (c: Config) => void }) {
  const [text, setText] = useState(config.price_list)
  const [check, setCheck] = useState<{ items: { name: string; price: number; in_stock: boolean; country: string | null; sim: string | null; color_ru: string | null; few?: boolean }[]; count: number; errors: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(async () => {
      setCheck(await call(api, '/price-list/check', { method: 'POST', body: { text } }))
    }, 400)
    return () => window.clearTimeout(t)
  }, [api, text])
  const save = async () => {
    setBusy(true)
    const c = await call<Config>(api, '/settings', { method: 'PUT', body: { price_list: text } })
    setBusy(false)
    if (c) { setConfig(c); toast('Прайс сохранён — бот уже отвечает по нему', 'success') }
  }
  const dirty = text !== config.price_list
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className={CARD}>
        <h3 className="mb-1 font-semibold text-white">Актуальные цены для бота</h3>
        <p className="mb-3 text-sm text-slate-400">
          Главный источник цен и наличия: бот берёт цену отсюда — и в первом сообщении, и в ответах. Чего нет в прайсе, бот ищет в каталоге сайта.
          Вставляйте прайс как есть, как присылаете в Telegram: «17Pro 256 Orange - 94000🇰🇷1SIM.», «16 128 Teal 🇮🇳 - 59.700».
          Бот поймёт модель (17Pro, 17Air, 17e — это iPhone), объём, цвет (и с опечатками), страну по флажку и SIM (1SIM — SIM + eSIM, eSIM — только eSIM). 🏎️ — осталось мало: бот предложит забронировать заранее.
          Заголовки «ПРАЙС…» и разделители пропускаются. Одна и та же позиция несколько раз — действует последняя по тексту.
          Можно и таблицей: <code className="text-slate-200">Модель; Память; Цвет; Цена; Наличие</code>. Строка с # — комментарий.
        </p>
        <textarea className={`${INPUT} h-[55vh] font-mono text-[13px]`} value={text} onChange={e => setText(e.target.value)} placeholder={PRICE_EXAMPLE} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{check ? `Позиций: ${check.count}${check.errors.length ? ` · ошибок: ${check.errors.length}` : ''}` : ''}</span>
          <button type="button" onClick={save} disabled={!dirty || busy} className={BTN_PRIMARY}>{busy ? 'Сохраняем…' : 'Сохранить прайс'}</button>
        </div>
      </div>
      <div className={`${CARD} self-start`}>
        <h3 className="mb-3 text-sm font-semibold text-white">Как бот это прочитает{check && check.count > 0 ? <span className="ml-2 font-normal text-slate-400">· позиций: {check.count}</span> : null}</h3>
        {check?.errors.length ? <div className="mb-3 space-y-1 text-xs text-rose-300">{check.errors.map(e => <div key={e}>{e}</div>)}</div> : null}
        {!check || check.count === 0 ? <div className="text-sm text-slate-500">Прайс пуст — бот берёт цены из каталога сайта.</div> : (
          <div className="divide-y divide-white/[0.05] text-sm">
            {check.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3 py-1.5">
                <span className={it.in_stock ? 'text-slate-200' : 'text-slate-500 line-through'}>
                  {it.name}
                  {(it.country || it.sim) && <span className="ml-1.5 text-xs text-slate-500">{[it.country, it.sim].filter(Boolean).join(' · ')}</span>}
                  {it.few && <span className="ml-1.5 text-xs text-amber-400">осталось мало</span>}
                </span>
                <span className="shrink-0 tabular-nums text-white">{Math.round(it.price).toLocaleString('ru-RU')} ₽</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Аналитика ────────────────────────────────────────────────────────────────

const PERIODS = [7, 30, 90] as const

function fmtDuration(s: number | null): string {
  if (s === null) return '—'
  if (s < 60) return `${Math.round(s)} с`
  if (s < 3600) return `${Math.round(s / 60)} мин`
  return `${(s / 3600).toFixed(1).replace('.', ',')} ч`
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const num = (n: number) => n.toLocaleString('ru-RU')

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-1.5 truncate text-2xl font-bold text-white" title={value}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

function TopList({ title, items, empty }: { title: string; items: AnalyticsTop[]; empty: string }) {
  const max = Math.max(1, ...items.map(i => i.count))
  return (
    <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
      <h3 className="mb-4 text-sm font-semibold text-white">{title}</h3>
      {items.length === 0 ? <div className="py-4 text-center text-sm text-slate-500">{empty}</div> : (
        <div className="space-y-3">
          {items.map(i => (
            <div key={i.label}>
              <div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate text-slate-200" title={i.label}>{i.label}</span><span className="font-semibold text-white">{i.count}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-yellow-400" style={{ width: `${Math.max(3, (i.count / max) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BotAnalyticsTab({ api }: { api: Api }) {
  const [days, setDays] = useState<number>(7)
  const [a, setA] = useState<BotAnalytics | null>(null)
  useEffect(() => {
    let alive = true
    call<BotAnalytics>(api, `/analytics?days=${days}`).then(r => { if (alive && r) setA(r) })
    return () => { alive = false }
  }, [api, days])

  const maxDay = a ? Math.max(1, ...a.series.map(d => d.bot_replies + d.staff_replies)) : 1
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <button key={p} type="button" onClick={() => setDays(p)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${days === p ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:bg-white/[0.06]'}`}>{p} дней</button>
        ))}
        <span className="text-xs text-slate-500">Тренировочные диалоги не считаются</span>
      </div>
      {!a ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Диалогов" value={num(a.dialogs_active)} hint={`новых ${num(a.dialogs_new)} · сообщений покупателей ${num(a.client_messages)}`} />
            <Stat label="Без участия человека" value={pct(a.auto_handled, a.dialogs_active)} hint={`${num(a.auto_handled)} из ${num(a.dialogs_active)} · звал человека ${num(a.handoffs)} раз`} />
            <Stat label="Время первого ответа" value={fmtDuration(a.response_median_s)} hint={`медиана · у 90% быстрее ${fmtDuration(a.response_p90_s)}`} />
            <Stat label="Брони из чата" value={num(a.orders)} hint={`${Math.round(a.orders_sum).toLocaleString('ru-RU')} ₽ · конверсия ${pct(a.orders, a.dialogs_active)}`} />
            <Stat label="Ответил бот" value={num(a.bot_replies)} hint={`автоответом ${num(a.bot_by_rule)} · моделью ${num(a.bot_by_llm)} · сотрудники ${num(a.staff_replies)}`} />
            <Stat label="Напоминаний" value={num(a.reminders)} hint={`ответили ${num(a.reminders_replied)} (${pct(a.reminders_replied, a.reminders)}) · брони ${num(a.reminders_orders)}`} />
            <Stat label="Модель" value={a.llm_cost !== null ? `${a.llm_cost.toLocaleString('ru-RU')} ₽` : `${num(a.llm_calls)} вызовов`}
              hint={`${num(a.llm_calls)} вызовов · ошибок ${num(a.llm_errors)} · токенов ${num(a.llm_tokens_in + a.llm_tokens_out)}`} />
            <Stat label="Выучено правок" value={num(a.examples_learned)} hint="ответы сотрудников, на которые бот теперь опирается" />
          </div>

          <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">Ответы по дням</h3>
              <div className="flex gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-yellow-400" />бот</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-slate-400" />сотрудники</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />брони</span>
              </div>
            </div>
            <div className="flex h-44 items-end gap-1">
              {a.series.map(d => {
                const total = d.bot_replies + d.staff_replies
                const label = new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                return (
                  <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label}: бот ${d.bot_replies}, сотрудники ${d.staff_replies}, новых диалогов ${d.dialogs}, броней ${d.orders}`}>
                    {d.orders > 0 && <div className="mx-auto mb-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                    <div className="flex flex-col overflow-hidden rounded-t" style={{ height: `${(total / maxDay) * 100}%`, minHeight: total ? 3 : 0 }}>
                      <div className="bg-slate-400/70" style={{ flex: d.staff_replies }} />
                      <div className="bg-yellow-400" style={{ flex: d.bot_replies }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-500">
              <span>{new Date(a.series[0]?.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
              <span>{new Date(a.series[a.series.length - 1]?.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopList title="Частые автоответы" items={a.top_rules} empty="Автоответы ещё не срабатывали" />
            <TopList title="Почему звал человека" items={a.top_handoff_reasons} empty="Бот справлялся сам" />
          </div>
        </>
      )}
    </div>
  )
}

// ── Обучение ─────────────────────────────────────────────────────────────────

function LearningTab({ api, reloadRules, onOpenChat }: { api: Api; reloadRules: () => void; onOpenChat: (id: string) => void }) {
  const [data, setData] = useState<{ examples: Example[]; unanswered: Unanswered[] } | null>(null)
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
  const load = useCallback(async () => { setData(await call(api, '/learning')) }, [api])
  useEffect(() => { const t = window.setTimeout(load, 0); return () => window.clearTimeout(t) }, [load])

  const toggle = async (e: Example) => { if (await call(api, `/examples/${e.id}`, { method: 'PATCH', body: { is_active: !e.is_active } }) !== null) load() }
  const remove = async (e: Example) => { if (await call(api, `/examples/${e.id}`, { method: 'DELETE' }) !== null) load() }
  const dismiss = async (u: Unanswered) => { if (await call(api, `/chats/${u.chat_id}/dismiss-question`, { method: 'POST' }) !== null) load() }
  const toRule = (answer: string) => setRuleDraft({ ...NEW_RULE, answer })

  if (!data) return <Loading />
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section>
        <h3 className="mb-1 font-semibold text-white">Бот не смог ответить</h3>
        <p className="mb-3 text-sm text-slate-500">Вопросы, на которых бот позвал человека. Ответьте покупателю в диалоге — ответ запомнится. Частый вопрос лучше превратить в автоответ.</p>
        {data.unanswered.length === 0 ? <div className={`${CARD} text-sm text-slate-400`}>Таких вопросов нет.</div> : (
          <div className="space-y-2">
            {data.unanswered.map(u => (
              <div key={u.chat_id} className={CARD}>
                <div className="text-sm text-white">«{u.question}»</div>
                <div className="mt-1 text-xs text-slate-500">{[u.client_name, u.item_title, u.reason, timeShort(u.at)].filter(Boolean).join(' · ')}</div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onOpenChat(u.chat_id)} className={BTN_ROW}>Открыть диалог</button>
                  <button type="button" onClick={() => setRuleDraft({ ...NEW_RULE })} className={BTN_ROW}>Создать автоответ</button>
                  <button type="button" onClick={() => dismiss(u)} className={BTN_ROW}>Убрать</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-1 font-semibold text-white">Как сотрудники поправили бота · {data.examples.length}</h3>
        <p className="mb-3 text-sm text-slate-500">Когда вы правите черновик или отвечаете вместо бота, пара «вопрос → ваш ответ» сохраняется. В похожих вопросах бот опирается на неё. Выключите пример, если он устарел.</p>
        {data.examples.length === 0 ? <div className={`${CARD} text-sm text-slate-400`}>Пока пусто — примеры появятся после первых правок.</div> : (
          <div className="space-y-2">
            {data.examples.map(e => (
              <div key={e.id} className={`${CARD} ${e.is_active ? '' : 'opacity-50'}`}>
                <div className="text-xs text-slate-500">Покупатель{e.item_title ? ` · ${e.item_title}` : ''} · {timeShort(e.created_at)}</div>
                <div className="text-sm text-slate-200">{e.question}</div>
                {e.bot_answer && <div className="mt-2 text-xs text-slate-500 line-through decoration-slate-600">{e.bot_answer}</div>}
                <div className="mt-1 text-sm text-yellow-100">{e.answer}</div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Toggle checked={e.is_active} onChange={() => toggle(e)} label="" />
                  <button type="button" onClick={() => toRule(e.answer)} className={BTN_ROW}>Сделать автоответом</button>
                  <button type="button" onClick={() => remove(e)} className={`${BTN_ROW} text-rose-300`} aria-label="Удалить пример"><AdminIcon name="trash" className="h-4 w-4" /></button>
                  {e.chat_id && <button type="button" onClick={() => onOpenChat(e.chat_id!)} className="text-xs text-slate-500 hover:text-slate-300">диалог</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {ruleDraft && <RuleModal api={api} id={null} initial={ruleDraft} onClose={() => setRuleDraft(null)} onSaved={() => { setRuleDraft(null); reloadRules(); toast('Автоответ создан', 'success') }} />}
    </div>
  )
}

// ── Автоответы ───────────────────────────────────────────────────────────────

function RulesTab({ api, rules, reload }: { api: Api; rules: Rule[] | null; reload: () => void }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!rules) return []
    return q ? rules.filter(r => r.keywords.some(k => k.toLowerCase().includes(q)) || r.answer.toLowerCase().includes(q)) : rules
  }, [rules, query])

  const toggle = async (r: Rule) => {
    const res = await call(api, `/rules/${r.id}`, { method: 'PATCH', body: { is_active: !r.is_active } })
    if (res !== null) reload()
  }
  const remove = async (r: Rule) => {
    if (!(await confirmDialog({ title: 'Удалить автоответ?', message: `«${r.keywords.join(', ')}» больше не будет срабатывать.`, confirmLabel: 'Удалить', danger: true }))) return
    const res = await call(api, `/rules/${r.id}`, { method: 'DELETE' })
    if (res !== null) { toast('Удалено', 'success'); reload() }
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${INPUT} max-w-xs`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти по слову или ответу" />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className={BTN_SECONDARY}>Импорт текстом</button>
          <button type="button" onClick={() => setEditing({ id: null, draft: { ...NEW_RULE, sort: rules?.length || 0 } })} className={BTN_PRIMARY}><AdminIcon name="plus" className="h-4 w-4" />Добавить</button>
        </div>
      </div>

      <div className={`${CARD} mb-4 text-sm text-slate-400`}>
        Короткий вопрос со словом из правила получает ваш текст дословно. Если вопрос сложнее (несколько вопросов сразу, отказ «нет, спасибо»)
        и модель подключена, она отвечает своими словами, опираясь на этот текст. Все автоответы — ещё и база знаний бота.
        Слово со звёздочкой ловит любые окончания: <code className="text-slate-200">рассроч*</code>.
      </div>

      {rules === null ? <Loading /> : shown.length === 0 ? (
        <div className={`${CARD} text-sm text-slate-400`}>{rules.length ? 'Ничего не нашлось.' : 'Автоответов пока нет. Добавьте первый или вставьте все сразу через «Импорт текстом».'}</div>
      ) : (
        <div className="space-y-3">
          {shown.map(r => (
            <div key={r.id} className={`${CARD} flex gap-4 ${r.is_active ? '' : 'opacity-50'}`}>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {r.keywords.map(k => <span key={k} className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-sm text-slate-100">{k}</span>)}
                </div>
                <div className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-300">{r.answer}</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{scheduleText(r)}</span>
                  <span>задержка {r.delay_seconds} с</span>
                  <span>{r.max_per_chat ? `${r.max_per_chat}× за диалог` : 'без лимита'}</span>
                  <span>{r.verbatim ? 'дословно' : 'своими словами'}</span>
                  <span>сработало {r.hits}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
                <Toggle checked={r.is_active} onChange={() => toggle(r)} label="" />
                <button type="button" onClick={() => setEditing({ id: r.id, draft: stripRule(r) })} className={BTN_ROW} aria-label="Изменить"><AdminIcon name="edit" className="h-4 w-4" /></button>
                <button type="button" onClick={() => setEditing({ id: null, draft: { ...stripRule(r), sort: rules.length } })} className={BTN_ROW} aria-label="Копировать"><AdminIcon name="copy" className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(r)} className={`${BTN_ROW} text-rose-300`} aria-label="Удалить"><AdminIcon name="trash" className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <RuleModal api={api} id={editing.id} initial={editing.draft} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {importOpen && <ImportModal api={api} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); reload() }} />}
    </div>
  )
}

function stripRule(r: Rule): RuleDraft {
  return { keywords: r.keywords, answer: r.answer, verbatim: r.verbatim, time_from: r.time_from, time_to: r.time_to, days: r.days, delay_seconds: r.delay_seconds, max_per_chat: r.max_per_chat, is_active: r.is_active, sort: r.sort }
}

function RuleModal({ api, id, initial, onClose, onSaved }: { api: Api; id: string | null; initial: RuleDraft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<RuleDraft>(initial)
  const [keys, setKeys] = useState(initial.keywords.join(', '))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD(prev => ({ ...prev, [k]: v }))
  const save = async () => {
    const keywords = keys.split(',').map(k => k.trim()).filter(Boolean)
    if (!keywords.length) return toast('Добавьте хотя бы одно ключевое слово', 'error')
    if (!d.answer.trim()) return toast('Напишите ответ', 'error')
    if (!d.days.length) return toast('Выберите хотя бы один день', 'error')
    setBusy(true)
    const body = { ...d, keywords, answer: d.answer.trim() }
    const res = id ? await call(api, `/rules/${id}`, { method: 'PATCH', body }) : await call(api, '/rules', { method: 'POST', body })
    setBusy(false)
    if (res !== null) { toast('Сохранено', 'success'); onSaved() }
  }
  return (
    <Modal title={id ? 'Автоответ' : 'Новый автоответ'} onClose={onClose}>
      <label className="block"><span className={LABEL}>Ключевые слова через запятую</span>
        <input className={`${INPUT} mt-1.5`} value={keys} onChange={e => setKeys(e.target.value)} placeholder="адрес, как вас найти, где вы находитесь" autoFocus /></label>
      <label className="mt-3 block"><span className={LABEL}>Ответ</span>
        <textarea className={`${INPUT} mt-1.5 h-32`} value={d.answer} onChange={e => set('answer', e.target.value)} placeholder="ТЦ Багратионовский, ул. Барклая 10, павильон А60" /></label>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block"><span className={LABEL}>С</span><input type="time" className={`${INPUT} mt-1.5`} value={d.time_from} onChange={e => set('time_from', e.target.value)} /></label>
        <label className="block"><span className={LABEL}>До</span><input type="time" className={`${INPUT} mt-1.5`} value={d.time_to} onChange={e => set('time_to', e.target.value)} /></label>
        <label className="block"><span className={LABEL}>Задержка, с</span><input type="number" min={0} max={600} className={`${INPUT} mt-1.5`} value={d.delay_seconds} onChange={e => set('delay_seconds', Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="block"><span className={LABEL}>Раз за диалог</span><input type="number" min={0} max={100} className={`${INPUT} mt-1.5`} value={d.max_per_chat} onChange={e => set('max_per_chat', Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>
      <div className="mt-1 text-xs text-slate-500">Время московское. «Раз за диалог» 0 — без ограничения.</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {DAYS.map((day, i) => {
          const on = d.days.includes(i)
          return <button key={day} type="button" onClick={() => set('days', on ? d.days.filter(x => x !== i) : [...d.days, i].sort())}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${on ? 'bg-yellow-400/20 text-yellow-200' : 'bg-white/[0.05] text-slate-500'}`}>{day}</button>
        })}
      </div>
      <div className="mt-4 space-y-3">
        <Toggle checked={d.verbatim} onChange={v => set('verbatim', v)} label="Отправлять текст дословно"
          hint="Выключите, чтобы модель каждый раз отвечала своими словами по этому тексту (нужна подключённая модель)" />
        <Toggle checked={d.is_active} onChange={v => set('is_active', v)} label="Включён" />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
        <button type="button" onClick={save} disabled={busy} className={BTN_PRIMARY}>Сохранить</button>
      </div>
    </Modal>
  )
}

const IMPORT_EXAMPLE = `адрес, как вас найти, где вы находитесь
ТЦ Багратионовский, ул. Барклая 10, 1 этаж, павильон А60. Работаем с 10:30 до 21:00.

гарантия, гарантии
Гарантия: 12 месяцев от производителя, 14 дней от нашего магазина.

оплата | Наличный расчёт без %, картой +16%, переводом по номеру телефона.`

function ImportModal({ api, onClose, onDone }: { api: Api; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!text.trim()) return toast('Вставьте автоответы', 'error')
    if (replace && !(await confirmDialog({ title: 'Заменить все автоответы?', message: 'Текущие правила удалятся.', confirmLabel: 'Заменить', danger: true }))) return
    setBusy(true)
    const res = await call<{ created: number; skipped: number; errors: string[] }>(api, '/rules/import', { method: 'POST', body: { text, replace } })
    setBusy(false)
    if (!res) return
    toast(`Добавлено ${res.created}${res.skipped ? `, уже было ${res.skipped}` : ''}${res.errors.length ? `, ошибок ${res.errors.length}` : ''}`, res.errors.length ? 'info' : 'success', 6000)
    if (res.errors.length) console.warn('Импорт автоответов:', res.errors)
    onDone()
  }
  return (
    <Modal title="Импорт автоответов" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-400">
        Вставьте автоответы из старого сервиса или таблицы. Блоки разделяйте пустой строкой: первая строка — ключевые слова через запятую,
        дальше — ответ. Можно и в одну строку: <code className="text-slate-200">слова | ответ</code> или две колонки из таблицы.
      </p>
      <textarea className={`${INPUT} h-72 font-mono text-[13px]`} value={text} onChange={e => setText(e.target.value)} placeholder={IMPORT_EXAMPLE} />
      <div className="mt-3"><Toggle checked={replace} onChange={setReplace} label="Заменить текущие автоответы" hint="Иначе новые добавятся к существующим, совпадающие по словам пропустятся" /></div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_SECONDARY}>Отмена</button>
        <button type="button" onClick={submit} disabled={busy} className={BTN_PRIMARY}>Импортировать</button>
      </div>
    </Modal>
  )
}

// ── Тест ─────────────────────────────────────────────────────────────────────

interface TestTurn { author: 'client' | 'bot'; text: string; decision?: Decision; whole?: boolean }
interface ListingPrice { price: string | null; source: string | null; matched: string | null }
interface RunRow { label: string; question: string; d: Decision | null }

const QUICK: readonly (readonly [string, string])[] = [
  ['Наличие', 'Здравствуйте! Ещё продаётся?'],
  ['Цвет и память', '16/128 белый есть?'],
  ['Японец', 'Японец 17 про 256 оранжевый есть? Сколько стоит?'],
  ['С физической SIM', 'А с физической симкой есть?'],
  ['Регион', 'Какой регион у этого телефона?'],
  ['Trade-in', 'Хочу в трейд-ин айфон 14 Pro, сколько доплатить?'],
  ['Trade-in Android', 'А самсунг в трейд-ин возьмёте?'],
  ['Доставка', 'А доставка есть? Я в Подольске'],
  ['Оплата картой', 'Можно оплатить картой? Сколько комиссия?'],
  ['Гарантия', 'Гарантия есть?'],
  ['Торг', 'Скинете за наличные?'],
  ['Не по теме', 'Реши уравнение 2x + 3 = 11'],
  ['«Вы бот?»', 'Вы бот или живой человек?'],
  ['Отказ', 'Уже не актуально, спасибо'],
  ['Позвать человека', 'Позовите менеджера, у меня проблема с прошлым заказом'],
]
const SCRIPTS: readonly { title: string; steps: readonly string[] }[] = [
  { title: 'Бронь, самовывоз', steps: ['Здравствуйте, ещё продаётся?', 'Беру. Как забронировать?', 'Заберу сам', 'Иван Петров, +7 999 123-45-67'] },
  { title: 'Бронь, доставка', steps: ['Добрый день, актуально?', 'Беру, нужна доставка по Москве', 'Тверская 1, кв 5', 'Анна Смирнова, 89991234567, почта anna@mail.ru'] },
]

function TestTab({ api, rules }: { api: Api; rules: Rule[] | null }) {
  const [item, setItem] = useState('iPhone 17 Pro 256 ГБ')
  const [price, setPrice] = useState('')
  const [turns, setTurns] = useState<TestTurn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [listings, setListings] = useState<string[]>([])
  const [lp, setLp] = useState<ListingPrice | null>(null)
  const [run, setRun] = useState<RunRow[] | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const ruleName = (id: string | null) => rules?.find(r => r.id === id)?.keywords[0]

  useEffect(() => {
    call<Status>(api, '/status').then(r => r && setStatus(r))
    call<string[]>(api, '/test/listings').then(r => r && setListings(r))
  }, [api])
  useEffect(() => {
    const t = window.setTimeout(async () => {
      setLp(await call<ListingPrice>(api, `/test/listing?title=${encodeURIComponent(item)}`))
    }, 350)
    return () => window.clearTimeout(t)
  }, [api, item])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])

  const ask = (history: TestTurn[], t: string) => call<Decision>(api, '/test', {
    method: 'POST',
    body: { text: t, history: history.map(({ author, text }) => ({ author, text })), item_title: item || null, item_price: price || null },
  })
  const withAnswer = (prev: TestTurn[], t: string, d: Decision): TestTurn[] => [...prev, { author: 'client', text: t },
    ...(d.first_message ? [{ author: 'bot' as const, text: d.first_message, whole: true }] : []),
    ...(d.text ? [{ author: 'bot' as const, text: d.text, decision: d, whole: d.source !== 'llm' }] : [{ author: 'bot' as const, text: '', decision: d }])]

  const send = async (override?: string) => {
    const t = (override ?? text).trim()
    if (!t || busy) return
    setBusy(true)
    const d = await ask(turns, t)
    setBusy(false)
    if (!d) return
    if (override === undefined) setText('')
    setTurns(prev => withAnswer(prev, t, d))
  }
  const play = async (steps: readonly string[]) => {
    if (busy) return
    setBusy(true)
    let cur: TestTurn[] = []
    setTurns([])
    for (const t of steps) {
      setTurns([...cur, { author: 'client', text: t }])
      const d = await ask(cur, t)
      if (!d) break
      cur = withAnswer(cur, t, d)
      setTurns(cur)
    }
    setBusy(false)
  }
  const runAll = async () => {
    if (runBusy) return
    setRunBusy(true)
    const rows: RunRow[] = QUICK.map(([label, question]) => ({ label, question, d: null }))
    setRun(rows)
    for (let i = 0; i < rows.length; i += 4) {   // по четыре вопроса одновременно: быстро, но без перегрузки модели
      const batch = rows.slice(i, i + 4)
      const res = await Promise.all(batch.map(r => ask([], r.question)))
      res.forEach((d, j) => { rows[i + j] = { ...batch[j], d } })
      setRun([...rows])
    }
    setRunBusy(false)
  }

  const noModel = status && !status.llm_ready
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {status && (
          <div className={`rounded-xl border px-4 py-2.5 text-sm ${noModel ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200'}`}>
            {noModel ? 'Модель не подключена — отвечают только автоответы. Подключите модель во вкладке «Настройки», чтобы проверить живое общение.'
              : 'Модель подключена — бот отвечает как в настоящем диалоге: те же правила, прайс, каталог, trade-in. Ничего не сохраняется и в Авито не уходит.'}
          </div>
        )}
        <div className={`${CARD} flex min-h-[50vh] flex-col !p-0`}>
          <div className="max-h-[62vh] flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {turns.length === 0 && <div className="text-sm text-slate-500">Напишите как покупатель или нажмите готовую реплику справа — увидите, что ответит бот и почему.</div>}
            {turns.map((t, i) => t.author === 'client' ? (
              <div key={i} className="max-w-[80%]"><div className="inline-block rounded-2xl bg-white/[0.06] px-3.5 py-2 text-sm text-slate-100">{t.text}</div></div>
            ) : (
              <div key={i} className="ml-auto max-w-[85%] text-right">
                {t.text && (t.whole ? [t.text] : t.text.split(/\n\s*\n/)).filter(p => p.trim()).map((part, j) => (
                  <div key={j} className="mb-1 flex justify-end"><div className="inline-block whitespace-pre-wrap rounded-2xl bg-yellow-400/[0.14] px-3.5 py-2 text-left text-sm text-yellow-50">{part.trim()}</div></div>
                ))}
                {t.decision && <DecisionNote d={t.decision} ruleName={ruleName(t.decision.rule_id)} />}
              </div>
            ))}
            {busy && <div className="ml-auto text-right text-xs text-slate-500">бот думает…</div>}
            <div ref={bottom} />
          </div>
          <div className="flex gap-2 border-t border-white/[0.06] p-3">
            <input className={INPUT} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder="Сообщение покупателя" />
            <button type="button" onClick={() => send()} disabled={busy || !text.trim()} className={BTN_PRIMARY} aria-label="Отправить"><AdminIcon name="send" className="h-4 w-4" /></button>
          </div>
        </div>
        {run && (
          <div className={CARD}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">Прогон готовых вопросов{runBusy ? ' — идёт…' : ''}</h3>
              <button type="button" onClick={() => setRun(null)} className="text-xs text-slate-500 underline decoration-dotted">скрыть</button>
            </div>
            <div className="divide-y divide-white/[0.05] text-sm">
              {run.map(r => (
                <div key={r.label} className="grid gap-1 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
                  <div><div className="font-medium text-slate-200">{r.label}</div><div className="text-xs text-slate-500">{r.question}</div></div>
                  <div className="min-w-0">
                    {!r.d ? <span className="text-slate-500">…</span> : (
                      <>
                        {r.d.text ? <div className="whitespace-pre-wrap text-yellow-50">{r.d.text}</div> : <div className="text-slate-500">{r.d.action === 'silent' ? 'молчит' : 'без текста'}</div>}
                        <DecisionNote d={r.d} ruleName={ruleName(r.d.rule_id)} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-4 self-start">
        <div className={`${CARD} space-y-3`}>
          <label className="block"><span className={LABEL}>Объявление</span>
            <input className={`${INPUT} mt-1.5`} value={item} onChange={e => setItem(e.target.value)} list="avito-test-listings" placeholder="Название, как в объявлении" />
            <datalist id="avito-test-listings">{listings.map(l => <option key={l} value={l} />)}</datalist>
          </label>
          <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-slate-400">
            {!item.trim() ? 'Без объявления бот отвечает как на общий вопрос.'
              : lp?.price ? <>Розничная цена в первом сообщении: <b className="text-white">{lp.price}</b><br />из: {lp.source} — {lp.matched}</>
                : lp ? <span className="text-amber-300">Цена по этому названию не нашлась — первое сообщение уйдёт без строки с ценой, а менеджеру придёт пометка. Проверьте прайс или привяжите объявление к товару.</span> : 'Ищу цену…'}
          </div>
          <label className="block"><span className={LABEL}>Цена в объявлении</span><input className={`${INPUT} mt-1.5`} value={price} onChange={e => setPrice(e.target.value)} placeholder="Доплата по trade-in, например 25 000 ₽" /></label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setTurns([])} disabled={busy} className={`${BTN_ROW} flex-1`}>Начать заново</button>
            <button type="button" onClick={runAll} disabled={runBusy || busy} className={`${BTN_ROW} flex-1`}>{runBusy ? 'Идёт прогон…' : 'Прогнать все'}</button>
          </div>
        </div>
        <div className={CARD}>
          <h3 className="mb-2 text-sm font-semibold text-white">Готовые реплики</h3>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(([label, q]) => (
              <button key={label} type="button" disabled={busy} title={q} onClick={() => send(q)}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition hover:bg-white/[0.09] disabled:opacity-50">{label}</button>
            ))}
          </div>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-white">Диалоги целиком</h3>
          <div className="space-y-1.5">
            {SCRIPTS.map(sc => (
              <button key={sc.title} type="button" disabled={busy} onClick={() => play(sc.steps)}
                className={`${BTN_ROW} w-full !justify-start`}>▶ {sc.title}<span className="ml-2 text-xs text-slate-500">{sc.steps.length} сообщ.</span></button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">«Прогнать все» задаёт каждый вопрос в новом диалоге — быстро видно, где бот ошибается. В диалоге с бронью бот покажет, какую заявку оформил бы; настоящая заявка в «Заказах» не создаётся.</p>
        </div>
      </div>
    </div>
  )
}

function DecisionNote({ d, ruleName }: { d: Decision; ruleName?: string }) {
  const [open, setOpen] = useState(false)
  const label = d.action === 'handoff' ? `Позвал человека: ${d.reason || ''}`
    : d.action === 'silent' ? `Промолчал: ${d.reason || ''}`
      : d.source === 'rule' ? `Автоответ «${ruleName || '…'}», через ${d.delay_seconds} с`
        : `Модель${ruleName ? ` с подсказкой «${ruleName}»` : ''}${d.examples_used ? `, примеров сотрудников: ${d.examples_used}` : ''}, через ${d.delay_seconds} с`
  return (
    <div className="mt-1 text-[11px] text-slate-500">
      <span className={d.action === 'handoff' ? 'text-amber-300' : ''}>{label}</span>
      {d.order && <div className="text-emerald-300">Оформил бы бронь: {orderText(d.order)}</div>}
      {d.catalog.length > 0 && <button type="button" onClick={() => setOpen(o => !o)} className="ml-2 underline decoration-dotted">каталог ({d.catalog.length})</button>}
      {open && <div className="mt-1 space-y-0.5 text-left">{d.catalog.map(c => <div key={c}>{c}</div>)}</div>}
    </div>
  )
}

// ── Настройки ────────────────────────────────────────────────────────────────

function HealthCard({ api }: { api: Api }) {
  const [st, setSt] = useState<Status | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const r = await api('/status'); if (r.ok && alive) setSt(await r.json()) } catch { /* сеть */ }
    }
    const first = window.setTimeout(load, 0)
    const id = window.setInterval(() => { if (!document.hidden) load() }, 10000)
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(id) }
  }, [api])
  if (!st) return null
  const h = st.health
  const rows: [string, string, boolean][] = [
    ['Последнее сообщение через вебхук', ago(h.last_webhook_at), true],
    ['Проверка пропущенных', h.last_poll_error ? `ошибка: ${h.last_poll_error}` : ago(h.last_poll_at), !h.last_poll_error],
    ['Подобрано опросом (вебхук не донёс)', String(h.caught_by_poll), h.caught_by_poll === 0],
    ['Модель', h.llm_fail_streak ? `не отвечает (${h.llm_fail_streak} раза подряд): ${h.last_llm_error || ''}` : st.llm_ready ? 'отвечает' : 'не подключена', !h.llm_fail_streak],
    ['В очереди', `думает над ${h.queue_replies} · ждут отправки ${h.queue_sends}`, true],
  ]
  return (
    <section className={CARD}>
      <h3 className="mb-1 font-semibold text-white">Состояние</h3>
      <p className="mb-3 text-xs text-slate-500">Если что-то сломается — модель перестанет отвечать, Авито не пустит или вебхук начнёт терять сообщения — придёт push в приложение «Заказы» (не чаще раза в час).</p>
      <div className="divide-y divide-white/[0.05] text-sm">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <span className="text-slate-400">{k}</span><span className={`text-right ${ok ? 'text-slate-200' : 'text-amber-300'}`}>{v}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const PROVIDERS: { id: Config['llm_provider']; label: string; hint: string }[] = [
  { id: 'none', label: 'Без модели', hint: 'Только автоответы; на остальное бот зовёт человека' },
  { id: 'yandex', label: 'YandexGPT', hint: 'Данные остаются в России, оплата в рублях. Нужны API-ключ и ID каталога Yandex Cloud' },
  { id: 'timeweb', label: 'Timeweb', hint: 'ИИ-агент Timeweb Cloud: модель (в том числе Qwen) выбирается в панели агента, оплата в рублях. Нужны Access ID агента и токен авторизации' },
  { id: 'qwen', label: 'Qwen', hint: 'Напрямую у Alibaba Cloud (Model Studio), регион Сингапур. Серверы за рубежом. Qwen с оплатой в рублях — через Timeweb или YandexGPT (модель qwen3.6-35b-a3b)' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'Дёшево и хорошо по-русски. Серверы в Китае — учитывайте 152-ФЗ' },
  { id: 'openai_compatible', label: 'Другая', hint: 'Любой OpenAI-совместимый адрес: OpenRouter, свой сервер с Qwen и т.п.' },
]

function SettingsTab({ api, config, setConfig }: { api: Api; config: Config; setConfig: (c: Config) => void }) {
  const [form, setForm] = useState<Config>(config)
  const [llmKey, setLlmKey] = useState('')
  const [avitoSecret, setAvitoSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [check, setCheck] = useState<Decision | null>(null)
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(config) || llmKey !== '' || avitoSecret !== ''

  const save = async (patch?: Partial<Config>, quiet?: boolean): Promise<Config | null> => {
    const body: Record<string, unknown> = patch ?? {
      enabled: form.enabled, mode: form.mode, persona_name: form.persona_name, greeting: form.greeting, first_message: form.first_message, trade_in_prices: form.trade_in_prices, staff_takes_over: form.staff_takes_over, human_mode: form.human_mode, allow_emoji: form.allow_emoji, off_topic_silent: form.off_topic_silent, style: form.style, knowledge: form.knowledge,
      handoff_topics: form.handoff_topics, handoff_message: form.handoff_message, reply_delay_min: form.reply_delay_min,
      reply_delay_max: form.reply_delay_max, use_catalog: form.use_catalog, llm_provider: form.llm_provider,
      orders_enabled: form.orders_enabled, pickup_address: form.pickup_address, system_patterns: form.system_patterns,
      reminders_enabled: form.reminders_enabled, reminder_after_minutes: form.reminder_after_minutes,
      reminder_window_hours: form.reminder_window_hours, reminder_from: form.reminder_from, reminder_to: form.reminder_to,
      reminder_use_llm: form.reminder_use_llm, reminder_template: form.reminder_template,
      llm_price_in: form.llm_price_in, llm_price_out: form.llm_price_out,
      broadcast_interval_seconds: form.broadcast_interval_seconds,
      llm_base_url: form.llm_base_url, llm_model: form.llm_model, llm_folder_id: form.llm_folder_id, llm_temperature: form.llm_temperature,
      avito_client_id: form.avito_client_id, llm_api_key: llmKey, avito_client_secret: avitoSecret,
    }
    setBusy('save')
    const c = await call<Config>(api, '/settings', { method: 'PUT', body })
    setBusy(null)
    if (!c) return null
    setConfig(c); setForm(c); setLlmKey(''); setAvitoSecret('')
    if (!quiet) toast('Сохранено', 'success')
    return c
  }
  const connect = async () => {
    if (dirty && !(await save(undefined, true))) return
    setBusy('connect')
    const res = await call<{ ok: boolean; detail: string }>(api, '/connect', { method: 'POST' })
    setBusy(null)
    if (!res) return
    toast(res.detail, res.ok ? 'success' : 'error', 8000)
    const c = await call<Config>(api, '/settings')
    if (c) { setConfig(c); setForm(c) }
  }
  const checkLlm = async () => {
    if (dirty && !(await save(undefined, true))) return
    setBusy('llm')
    setCheck(await call<Decision>(api, '/llm-check', { method: 'POST' }))
    setBusy(null)
  }
  const provider = PROVIDERS.find(p => p.id === form.llm_provider)

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <section className={CARD}>
          <h3 className="mb-4 font-semibold text-white">Работа бота</h3>
          <div className="space-y-4">
            <Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Бот включён" hint="Выключенный бот только записывает входящие — отвечаете вы" />
            <div>
              <span className={LABEL}>Режим</span>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {([['draft', 'Черновики', 'Бот пишет ответ, сотрудник жмёт «Отправить». Для первых дней'], ['auto', 'Сам отвечает', 'Ответ уходит покупателю сразу после паузы']] as const).map(([id, label, hint]) => (
                  <button key={id} type="button" onClick={() => set('mode', id)}
                    className={`rounded-xl border p-3 text-left transition ${form.mode === id ? 'border-yellow-400/60 bg-yellow-400/[0.08]' : 'border-white/10 hover:bg-white/[0.04]'}`}>
                    <div className="text-sm font-medium text-white">{label}</div><div className="mt-0.5 text-xs text-slate-500">{hint}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className={LABEL}>Имя менеджера</span><input className={`${INPUT} mt-1.5`} value={form.persona_name} onChange={e => set('persona_name', e.target.value)} /></label>
              <label className="block"><span className={LABEL}>Пауза от, с</span><input type="number" min={0} className={`${INPUT} mt-1.5`} value={form.reply_delay_min} onChange={e => set('reply_delay_min', Number(e.target.value) || 0)} /></label>
              <label className="block"><span className={LABEL}>до, с</span><input type="number" min={0} className={`${INPUT} mt-1.5`} value={form.reply_delay_max} onChange={e => set('reply_delay_max', Number(e.target.value) || 0)} /></label>
            </div>
            <label className="block"><span className={LABEL}>Первое сообщение в диалоге</span>
              <textarea className={`${INPUT} mt-1.5 h-36`} value={form.first_message} onChange={e => set('first_message', e.target.value)} /></label>
            <div className="text-xs text-slate-500"><code className="text-slate-300">{'{name}'}</code> — имя менеджера, <code className="text-slate-300">{'{price}'}</code> — розничная цена товара из объявления (из привязанной карточки или по названию объявления). Уходит первым сообщением в каждом новом диалоге, одним сообщением. Если надёжной цены нет, строка с ценой не отправляется. Пусто — бот здоровается по полю ниже.</div>
            <label className="block"><span className={LABEL}>Приветствие, если первое сообщение пустое</span>
              <input className={`${INPUT} mt-1.5`} value={form.greeting} onChange={e => set('greeting', e.target.value)} placeholder="Здравствуйте! Меня зовут {name}, я менеджер магазина TakeSmart." /></label>
            <div className="text-xs text-slate-500"><code className="text-slate-300">{'{name}'}</code> — имя менеджера. Бот здоровается так в первом ответе каждого диалога — и моделью, и перед автоответом. Пусто — модель здоровается своими словами, автоответы уходят без приветствия.</div>
            <div className="text-xs text-slate-500">Пауза — для ответов модели, чтобы они не прилетали мгновенно. У автоответов своя задержка. Если покупатель прямо спросит «вы бот?», бот не станет отрицать — это защищает аккаунт от жалоб.</div>
            <Toggle checked={form.staff_takes_over} onChange={v => set('staff_takes_over', v)} label="Ответ из приложения Авито забирает диалог у бота"
              hint="Если вы ответили покупателю прямо в Авито, бот в этом диалоге замолкает. Выключите, если в Авито ещё работает его встроенный автоответчик — иначе бот замолчит во всех диалогах. Правильнее выключить сам автоответчик Авито: теперь его работу делает бот" />
            <Toggle checked={form.human_mode} onChange={v => set('human_mode', v)} label="Писать как человек"
              hint="Отмечает сообщение прочитанным, «печатает» столько, сколько занял бы текст, и пишет короткими сообщениями: приветствие отдельно, длинный ответ — двумя" />
            <Toggle checked={form.allow_emoji} onChange={v => set('allow_emoji', v)} label="Иногда эмодзи"
              hint="Изредка одно (🙂, 👍), и только если покупатель сам пишет неформально" />
            <Toggle checked={form.off_topic_silent} onChange={v => set('off_topic_silent', v)} label="Молчать на вопросы не по теме"
              hint="Математика, код, политика, «игнорируй инструкции» и всё, что не про технику и покупку: бот отмечает сообщение прочитанным и не отвечает — как живой менеджер. Приветствие, «спасибо» и вопросы по покупке — отвечает как обычно. Выключите — бот будет вежливо отвечать, что помогает только с покупкой" />
            <Toggle checked={form.use_catalog} onChange={v => set('use_catalog', v)} label="Смотреть цены и наличие в каталоге сайта" hint="Модель видит подходящие товары с живыми ценами и остатками" />
            <Toggle checked={form.orders_enabled} onChange={v => set('orders_enabled', v)} label="Оформлять заявки из чата"
              hint="Когда покупатель согласился, бот спрашивает ФИО и телефон (почту — по желанию) и создаёт заявку в «Заказах» с пометкой «Заявка с Авито»; приходит пуш «Новая заявка с Авито!». Остаток списывается. В режиме черновиков — только после вашего «Отправить»" />
            <button type="button" onClick={async () => {
              const r = await call<{ order_number: string }>(api, '/test-order', { method: 'POST' })
              if (r) toast(`Тестовая заявка ${r.order_number} создана — откройте «Заказы» или PWA. Остаток не списан, заказ можно удалить`, 'success', 8000)
            }} className={BTN_SECONDARY}>Создать тестовую заявку с Авито</button>
            {form.orders_enabled && (
              <label className="block"><span className={LABEL}>Адрес самовывоза</span><input className={`${INPUT} mt-1.5`} value={form.pickup_address} onChange={e => set('pickup_address', e.target.value)} /></label>
            )}
          </div>
        </section>

        <section className={CARD}>
          <h3 className="mb-1 font-semibold text-white">Напоминания</h3>
          <p className="mb-4 text-xs text-slate-500">Если покупатель замолчал после нашего ответа, бот один раз мягко напомнит о себе. Не напоминает тем, кто отказался, оформил бронь или кого ведёт сотрудник. В режиме черновиков напоминание тоже ждёт вашего «Отправить».</p>
          <div className="space-y-4">
            <Toggle checked={form.reminders_enabled} onChange={v => set('reminders_enabled', v)} label="Напоминать замолчавшим" />
            {form.reminders_enabled && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="block"><span className={LABEL}>Через, ч</span>
                    <input type="number" min={0.1} max={24} step={0.5} className={`${INPUT} mt-1.5`} value={Math.round(form.reminder_after_minutes / 6) / 10}
                      onChange={e => set('reminder_after_minutes', Math.max(1, Math.round((Number(e.target.value) || 0) * 60)))} /></label>
                  <label className="block"><span className={LABEL}>Не позже, ч</span>
                    <input type="number" min={1} max={72} className={`${INPUT} mt-1.5`} value={form.reminder_window_hours}
                      onChange={e => set('reminder_window_hours', Math.max(1, Math.min(72, Number(e.target.value) || 1)))} /></label>
                  <label className="block"><span className={LABEL}>Писать с</span><input type="time" className={`${INPUT} mt-1.5`} value={form.reminder_from} onChange={e => set('reminder_from', e.target.value)} /></label>
                  <label className="block"><span className={LABEL}>До</span><input type="time" className={`${INPUT} mt-1.5`} value={form.reminder_to} onChange={e => set('reminder_to', e.target.value)} /></label>
                </div>
                <div className="text-xs text-slate-500">Напоминание уходит через {Math.round(form.reminder_after_minutes / 6) / 10} ч тишины, только по диалогам моложе {form.reminder_window_hours} ч и только с {form.reminder_from} до {form.reminder_to} по Москве.</div>
                <Toggle checked={form.reminder_use_llm} onChange={v => set('reminder_use_llm', v)} label="Текст пишет модель по ходу разговора"
                  hint="Модель сама решит, уместно ли напоминать. Без модели — шаблон ниже" />
                <label className="block"><span className={LABEL}>Шаблон</span>
                  <textarea className={`${INPUT} mt-1.5 h-20`} value={form.reminder_template} onChange={e => set('reminder_template', e.target.value)} /></label>
                <div className="text-xs text-slate-500"><code className="text-slate-300">{'{item}'}</code> — название объявления, <code className="text-slate-300">{'{name}'}</code> — имя покупателя.</div>
              </>
            )}
          </div>
        </section>

        <section className={CARD}>
          <h3 className="mb-1 font-semibold text-white">Рассылки</h3>
          <p className="mb-3 text-xs text-slate-500">Сообщения уходят по одному. Медленнее — безопаснее для аккаунта: массовые одинаковые сообщения Авито может счесть спамом.</p>
          <label className="block max-w-[200px]"><span className={LABEL}>Пауза между сообщениями, с</span>
            <input type="number" min={2} max={120} className={`${INPUT} mt-1.5`} value={form.broadcast_interval_seconds}
              onChange={e => set('broadcast_interval_seconds', Math.max(2, Math.min(120, Number(e.target.value) || 2)))} /></label>
        </section>

        <HealthCard api={api} />

        <section className={CARD}>
          <h3 className="mb-4 font-semibold text-white">Как общаться и что знать</h3>
          <label className="block"><span className={LABEL}>Стиль общения</span><textarea className={`${INPUT} mt-1.5 h-32`} value={form.style} onChange={e => set('style', e.target.value)} /></label>
          <label className="mt-3 block"><span className={LABEL}>База знаний</span>
            <textarea className={`${INPUT} mt-1.5 h-40`} value={form.knowledge} onChange={e => set('knowledge', e.target.value)}
              placeholder={'Например:\nЦена в объявлении — с учётом trade-in, без обмена дороже.\nДоставка по Москве за 30 минут, 500 ₽.\nБронь держим до конца дня.'} />
          </label>
          <div className="mt-1 text-xs text-slate-500">Всё, что не уместилось в автоответы. Автоответы бот тоже знает — дублировать не нужно.</div>
          <label className="mt-3 block"><span className={LABEL}>Когда звать человека</span><input className={`${INPUT} mt-1.5`} value={form.handoff_topics} onChange={e => set('handoff_topics', e.target.value)} /></label>
          <label className="mt-3 block"><span className={LABEL}>Что написать, пока зовём человека</span>
            <input className={`${INPUT} mt-1.5`} value={form.handoff_message} onChange={e => set('handoff_message', e.target.value)} placeholder="Сейчас уточню у коллеги и вернусь к вам. Пусто — бот молчит" />
            <span className="mt-1 block text-xs text-slate-500">Только когда покупатель сам просит менеджера. При сбое, нехватке цены или данных бот ничего не пишет: отмечает прочитанным и зовёт вас.</span></label>
          <label className="mt-3 block"><span className={LABEL}>Оценка trade-in</span>
            <textarea className={`${INPUT} mt-1.5 h-72 font-mono text-[13px]`} value={form.trade_in_prices} onChange={e => set('trade_in_prices', e.target.value)} /></label>
          <div className="mt-1 text-xs text-slate-500">Какие модели принимаем в trade-in, вилки оценки и правила. Бот называет только предварительную вилку «до …» и не берёт ничего, чего нет в списке.</div>
          <label className="mt-3 block"><span className={LABEL}>Системные сообщения Авито</span>
            <textarea className={`${INPUT} mt-1.5 h-28 font-mono text-[13px]`} value={form.system_patterns} onChange={e => set('system_patterns', e.target.value)} /></label>
          <div className="mt-1 text-xs text-slate-500">По одной фразе в строке. Сообщение, в котором есть такая фраза, бот считает служебным сообщением Авито: не отвечает на него и не учитывает в разговоре, в диалоге оно показывается серой плашкой. Служебные типы сообщений Авито бот пропускает и без этого списка. Если бот ответил на системное сообщение — скопируйте сюда его кусок.</div>
        </section>
      </div>

      <div className="space-y-4">
        <section className={CARD}>
          <h3 className="mb-1 font-semibold text-white">Модель</h3>
          <p className="mb-4 text-xs text-slate-500">{provider?.hint}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROVIDERS.map(p => (
              <button key={p.id} type="button" onClick={() => set('llm_provider', p.id)}
                className={`rounded-xl border px-3 py-2 text-sm transition ${form.llm_provider === p.id ? 'border-yellow-400/60 bg-yellow-400/[0.08] text-white' : 'border-white/10 text-slate-400 hover:bg-white/[0.04]'}`}>{p.label}</button>
            ))}
          </div>
          {form.llm_provider !== 'none' && (
            <div className="mt-4 space-y-3">
              {form.llm_provider === 'timeweb' && (
                <>
                  <label className="block"><span className={LABEL}>Access ID агента</span><input className={`${INPUT} mt-1.5`} value={form.llm_folder_id} onChange={e => set('llm_folder_id', e.target.value)} placeholder="620888ae-d3cb-…" autoComplete="off" /></label>
                  <div className="text-xs text-slate-500">Панель Timeweb → ИИ-агенты → ваш агент → «Доступ по API». Токен — там же: «Изменить» → «Добавить новый ключ» (показывается один раз). Модель выбирается в настройках агента. Системный промпт и базу знаний в панели агента лучше оставить пустыми — инструкции бот передаёт сам.</div>
                </>
              )}
              <label className="block"><span className={LABEL}>{form.llm_provider === 'timeweb' ? 'Токен авторизации' : 'API-ключ'}</span>
                <input type="password" autoComplete="off" className={`${INPUT} mt-1.5`} value={llmKey} onChange={e => setLlmKey(e.target.value)}
                  placeholder={config.llm_api_key_set ? 'Задан — оставьте пустым, чтобы не менять' : 'Вставьте ключ'} /></label>
              {form.llm_provider === 'yandex' && (
                <label className="block"><span className={LABEL}>ID каталога Yandex Cloud</span><input className={`${INPUT} mt-1.5`} value={form.llm_folder_id} onChange={e => set('llm_folder_id', e.target.value)} placeholder="b1g…" /></label>
              )}
              {form.llm_provider === 'qwen' && (
                <label className="block"><span className={LABEL}>Workspace ID (необязательно)</span><input className={`${INPUT} mt-1.5`} value={form.llm_folder_id} onChange={e => set('llm_folder_id', e.target.value)} placeholder="из консоли Model Studio; пусто — общий адрес" /></label>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {form.llm_provider !== 'timeweb' && (
                <label className="block"><span className={LABEL}>Модель</span><input className={`${INPUT} mt-1.5`} value={form.llm_model} onChange={e => set('llm_model', e.target.value)}
                  placeholder={form.llm_provider === 'yandex' ? 'yandexgpt/latest или qwen3.6-35b-a3b' : form.llm_provider === 'deepseek' ? 'deepseek-chat' : form.llm_provider === 'qwen' ? 'qwen3.7-plus' : 'название модели'} /></label>
                )}
                <label className="block"><span className={LABEL}>Креативность {form.llm_temperature.toFixed(1)}</span>
                  <input type="range" min={0} max={1} step={0.1} className="mt-4 w-full accent-yellow-400" value={form.llm_temperature} onChange={e => set('llm_temperature', Number(e.target.value))} /></label>
              </div>
              {(form.llm_provider === 'timeweb' || form.llm_provider === 'qwen') && (
                <label className="block"><span className={LABEL}>{form.llm_provider === 'timeweb' ? 'OpenAI URL (необязательно — если Access ID не подошёл)' : 'Адрес API (для другого региона)'}</span>
                  <input className={`${INPUT} mt-1.5`} value={form.llm_base_url} onChange={e => set('llm_base_url', e.target.value)}
                    placeholder={form.llm_provider === 'timeweb' ? 'https://agent.timeweb.cloud/api/v1/cloud-ai/agents/…/v1' : 'https://<workspace>.us-east-1.maas.aliyuncs.com/compatible-mode/v1'} /></label>
              )}
              {form.llm_provider === 'openai_compatible' && (
                <label className="block"><span className={LABEL}>Адрес API</span><input className={`${INPUT} mt-1.5`} value={form.llm_base_url} onChange={e => set('llm_base_url', e.target.value)} placeholder="https://openrouter.ai/api/v1" /></label>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={LABEL}>₽ за 1 млн входных токенов</span><input type="number" min={0} step="any" className={`${INPUT} mt-1.5`} value={form.llm_price_in} onChange={e => set('llm_price_in', Math.max(0, Number(e.target.value) || 0))} /></label>
                <label className="block"><span className={LABEL}>₽ за 1 млн выходных</span><input type="number" min={0} step="any" className={`${INPUT} mt-1.5`} value={form.llm_price_out} onChange={e => set('llm_price_out', Math.max(0, Number(e.target.value) || 0))} /></label>
              </div>
              <div className="text-xs text-slate-500">Цены из тарифа провайдера — для расходов в «Аналитике». Можно не заполнять.</div>
              <button type="button" onClick={checkLlm} disabled={busy !== null} className={BTN_SECONDARY}>{busy === 'llm' ? 'Спрашиваем…' : 'Проверить модель'}</button>
              {check && (
                <div className={`rounded-xl p-3 text-sm ${check.action === 'reply' && check.source === 'llm' ? 'bg-emerald-400/10 text-emerald-200' : check.action === 'reply' ? 'bg-white/[0.05] text-slate-300' : 'bg-rose-400/10 text-rose-200'}`}>
                  {check.action === 'reply' && check.source === 'llm' ? <>Модель отвечает: «{check.text}»</>
                    : check.action === 'reply' ? <>Ответил автоответ — модель на этот вопрос не понадобилась: «{check.text}»</>
                      : <>Модель не ответила: {check.reason}</>}
                </div>
              )}
            </div>
          )}
        </section>

        <section className={CARD}>
          <h3 className="mb-1 font-semibold text-white">Авито</h3>
          <p className="mb-4 text-xs text-slate-500">Ключи — в личном кабинете Авито: Настройки → API (раздел для разработчиков). Нужен доступ к API мессенджера.</p>
          <div className="space-y-3">
            <label className="block"><span className={LABEL}>client_id</span><input className={`${INPUT} mt-1.5`} value={form.avito_client_id} onChange={e => set('avito_client_id', e.target.value)} autoComplete="off" /></label>
            <label className="block"><span className={LABEL}>client_secret</span>
              <input type="password" autoComplete="off" className={`${INPUT} mt-1.5`} value={avitoSecret} onChange={e => setAvitoSecret(e.target.value)}
                placeholder={config.avito_client_secret_set ? 'Задан — оставьте пустым, чтобы не менять' : 'Вставьте секрет'} /></label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={connect} disabled={busy !== null || !form.avito_client_id || (!config.avito_client_secret_set && !avitoSecret)} className={BTN_SECONDARY}>
                {busy === 'connect' ? 'Подключаем…' : config.avito_connected_at ? 'Переподключить' : 'Подключить'}
              </button>
              {config.avito_connected_at
                ? <span className="text-sm text-emerald-300">Подключено{config.avito_user_id ? ` · аккаунт ${config.avito_user_id}` : ''}</span>
                : <span className="text-sm text-slate-500">Не подключено</span>}
            </div>
            {config.webhook_url && (
              <div className="flex items-center gap-2 rounded-xl bg-black/30 p-2 pl-3 text-xs text-slate-400">
                <span className="min-w-0 flex-1 truncate">Сообщения приходят на {config.webhook_url.replace(/[^/]+$/, '•••')}</span>
                <button type="button" onClick={() => copyText(config.webhook_url!, 'Адрес скопирован')} className={BTN_ROW}>Скопировать</button>
              </div>
            )}
          </div>
        </section>

        <div className="sticky bottom-4 flex justify-end">
          <button type="button" onClick={() => save()} disabled={!dirty || busy !== null} className={BTN_PRIMARY}>{busy === 'save' ? 'Сохраняем…' : 'Сохранить настройки'}</button>
        </div>
      </div>
    </div>
  )
}
