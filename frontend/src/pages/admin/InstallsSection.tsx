import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { API_BASE_URL } from '../../lib/config'
import { toast } from '../../lib/toast'
import { DEFAULT_INSTALLS_CONFIG, withPoolMeta, type CatalogApp, type InstallAccount, type InstallOrder, type InstallsConfig, type OrderStats } from '../../lib/installs'
import { SegmentedTabs } from './AdminShell'
import { CatalogTab, NewOrderTab, OrderCard, OrdersTab, SettingsTab } from './InstallOrders'
import { CARD } from './installsUi'
import { type Api, type AuthFetch } from './installsApi'

// ─────────────────────────────────────────────────────────────────────────────
// «Приложения на iPhone». Схема «аккаунт салона» (InstallOrders.tsx): приложения
// ставятся на телефон покупателя из истории покупок Apple ID салона. Вкладки:
//   «Новый заказ», «Заказы», «Каталог», «Настройки».
// ─────────────────────────────────────────────────────────────────────────────

// ── Раздел ───────────────────────────────────────────────────────────────────
type View = 'new' | 'orders' | 'catalog' | 'settings'
const VIEWS: readonly View[] = ['new', 'orders', 'catalog', 'settings']
const ORDERS_POLL_MS = 5000

export function InstallsSection({ authFetch }: { authFetch: AuthFetch }) {
  const api = useCallback<Api>((path, init) => authFetch(`${API_BASE_URL}/api/installs${path}`, init), [authFetch])
  const [params, setParams] = useSearchParams()
  const [accounts, setAccounts] = useState<InstallAccount[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogApp[]>([])
  const [config, setConfig] = useState<InstallsConfig | null>(null)
  const [orders, setOrders] = useState<InstallOrder[] | null>(null)
  const [stats, setStats] = useState<OrderStats | null>(null)
  const announced = useRef<Set<string>>(new Set())
  const firstOrdersLoad = useRef(true)

  const reload = useCallback(async () => {
    try {
      const [a, c, s] = await Promise.all([api('/accounts'), api('/catalog'), api('/settings')])
      if (a.ok) setAccounts(await a.json())
      if (c.ok) setCatalog(withPoolMeta(await c.json()))
      if (s.ok) setConfig(await s.json())
      if (!a.ok || !s.ok) toast('Раздел загрузился не полностью — обновите страницу', 'error')
    } catch { toast('Нет связи с сервером', 'error') }
    // Раздел не должен зависнуть на «Загружаем…», даже если заказов ещё нет
    setAccounts(prev => prev ?? [])
    setConfig(prev => prev ?? DEFAULT_INSTALLS_CONFIG)
  }, [api])
  const loadOrders = useCallback(async () => {
    try {
      const [o, st] = await Promise.all([api('/orders?brief=true&limit=300'), api('/orders/stats')])
      if (st.ok) setStats(await st.json())
      if (!o.ok) return
      const list: InstallOrder[] = await o.json()
      setOrders(list)
      // Сигнал сотруднику: покупатель просит код или пришла заявка с сайта. Один раз на событие.
      for (const order of list) {
        const key = order.code_waiting ? `code:${order.id}:${order.code_requested_at}` : order.status === 'new' ? `new:${order.id}` : null
        if (!key || announced.current.has(key)) continue
        announced.current.add(key)
        if (!firstOrdersLoad.current || order.code_waiting) {
          toast(order.code_waiting ? `Заказ №${order.number}: покупатель ждёт код подтверждения` : `Новая заявка с сайта: заказ №${order.number}`, 'info', 8000)
        }
      }
      firstOrdersLoad.current = false
    } catch { /* сеть */ }
  }, [api])
  useEffect(() => {
    const first = window.setTimeout(() => { reload(); loadOrders() }, 0)
    const id = window.setInterval(() => { if (!document.hidden) loadOrders() }, ORDERS_POLL_MS)
    return () => { window.clearTimeout(first); window.clearInterval(id) }
  }, [reload, loadOrders])

  const hasCatalog = catalog.some(c => c.is_active)
  const openOrderId = params.get('order')
  const viewParam = params.get('view') as View | null
  // По умолчанию — «Новый заказ»; пока каталог не настроен — «Каталог», там объяснение и первые шаги
  const view: View | null = openOrderId ? 'orders' : viewParam && VIEWS.includes(viewParam) ? viewParam : accounts === null ? null : hasCatalog ? 'new' : 'catalog'
  const patchParams = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
      return next
    }, { replace: true })
  }, [setParams])
  const go = useCallback((v: View) => patchParams({ view: v, order: null }), [patchParams])
  const openOrder = useCallback((id: string | null) => patchParams({ view: 'orders', order: id }), [patchParams])

  // Установки на свой iPhone — не работа с покупателями: в счётчик вкладки не идут
  const openCount = (orders || []).filter(o => o.source !== 'own' && (o.status === 'new' || o.status === 'ready' || o.status === 'active')).length
  const needAttention = (orders || []).some(o => o.code_waiting || o.status === 'new')

  return (
    <div data-installs-root data-view={view || 'loading'}>
      {view === null ? (
        <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем раздел…</div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs<View>
          items={[
            { id: 'new', label: 'Новый заказ' },
            { id: 'orders', label: needAttention ? 'Заказы •' : 'Заказы', count: openCount || undefined },
            { id: 'catalog', label: 'Каталог', count: catalog.filter(c => c.is_active).length || undefined },
            { id: 'settings', label: config && !config.staff_code_set ? 'Настройки •' : 'Настройки' },
          ]}
          value={view}
          onChange={go}
        />
      </div>

      {accounts === null || config === null ? (
        <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем раздел…</div>
      ) : view === 'new' ? (
        <NewOrderTab api={api} accounts={accounts} catalog={catalog} config={config} goCatalog={() => go('catalog')} goSettings={() => go('settings')}
          onCreated={order => { loadOrders(); openOrder(order.id) }} />
      ) : view === 'orders' ? (
        <OrdersTab orders={orders} stats={stats} onOpen={openOrder} goNew={() => go('new')} />
      ) : view === 'settings' ? (
        <SettingsTab api={api} accounts={accounts} catalog={catalog} config={config} reload={reload} />
      ) : (
        <CatalogTab api={api} accounts={accounts} catalog={catalog} reload={reload} goSettings={() => go('settings')} />
      )}
      </>
      )}

      {openOrderId && (
        <OrderCard key={openOrderId} api={api} orderId={openOrderId} onClose={() => openOrder(null)} onChanged={loadOrders} />
      )}
    </div>
  )
}
