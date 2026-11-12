import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import { formatPrice } from '../../data/products'
import { toast } from '../../lib/toast'
import { confirmDialog } from '../../lib/confirm'
import {
  DEFAULT_GTA6_CONFIG, GTA6_DEFAULT_GIFT_TEXT, GTA6_DEFAULT_GIFT_TITLE, GTA6_SLOTS, gta6Asset, parseVideoUrl,
  type Gta6Config, type Gta6Slot,
} from '../../lib/gta6'
import { rankSearch } from '../../lib/searchRank'
import { AdminIcon } from './AdminIcons'
import { BTN_PRIMARY, BTN_SECONDARY } from './AdminShell'
import { pluralRu } from './format'
import { call, type Api, type AuthFetch } from './installsApi'
import { BTN_ROW, CARD, INPUT, LABEL, Toggle } from './installsUi'

// ─────────────────────────────────────────────────────────────────────────────
// Раздел «GTA VI»: страница /gta6 на сайте. Здесь сотрудник включает страницу,
// собирает подборку PlayStation 5 из существующих карточек товаров, задаёт
// условия подарка и при желании заменяет стандартные арты своими картинками.
// Переключатели и подборка сохраняются сразу; тексты подарка — кнопкой.
// ─────────────────────────────────────────────────────────────────────────────

export interface Gta6Product {
  id: string
  name: string
  sku: string | null
  brand: string | null
  price: number
  discount_price: number | null
  stock_quantity: number
  main_image_url: string | null
  is_active: boolean
  is_preorder?: boolean
  condition: string
}

const PS_PATTERN = /playstation|\bps\s?5\b|плейстейшн/i

export function Gta6Section<P extends Gta6Product>({ products, authFetch, imageUrl, compressImage, reloadKey, onCreate, onEdit }: {
  products: P[]
  authFetch: AuthFetch
  imageUrl: (url?: string | null) => string
  compressImage: (file: File, maxDim?: number, maxBytes?: number) => Promise<File>
  /** Меняется, когда подборку изменили снаружи (создан новый товар) — перечитываем настройки */
  reloadKey: number
  /** Открыть окно создания товара; после сохранения он сам встанет в подборку */
  onCreate: () => void
  onEdit: (product: P) => void
}) {
  const api = useCallback<Api>((path, init) => authFetch(`${API_BASE_URL}/api/gta6${path}`, init), [authFetch])
  const [config, setConfig] = useState<Gta6Config | null>(null)
  const [images, setImages] = useState<Partial<Record<Gta6Slot, string>>>({})
  const [saving, setSaving] = useState(false)
  const [giftTitle, setGiftTitle] = useState('')
  const [giftText, setGiftText] = useState('')
  const [trailerUrl, setTrailerUrl] = useState('')
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState<Gta6Slot | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingSlot = useRef<Gta6Slot | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cfg = await call<Gta6Config>(api, '/settings')
      // Готовые ссылки на картинки отдаёт публичная ручка (в настройках лежат ключи хранилища)
      const page = await fetch(`${API_BASE_URL}/api/gta6`).then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (cancelled) return
      const next = cfg ?? DEFAULT_GTA6_CONFIG
      setConfig(next)
      setGiftTitle(next.gift_title)
      setGiftText(next.gift_text)
      setTrailerUrl(next.trailer_url ?? '')
      setImages(page?.images ?? {})
    })()
    return () => { cancelled = true }
  }, [api, reloadKey])

  const save = async (patch: Partial<Gta6Config>, okMessage?: string): Promise<boolean> => {
    if (!config) return false
    setSaving(true)
    const saved = await call<Gta6Config>(api, '/settings', { method: 'PUT', body: { ...config, ...patch } })
    setSaving(false)
    if (!saved) return false
    setConfig(saved)
    if (okMessage) toast(okMessage, 'success')
    return true
  }

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const picked = useMemo(
    () => (config?.product_ids ?? []).map(id => byId.get(id)).filter((p): p is P => Boolean(p)),
    [config, byId],
  )
  const pickedIds = useMemo(() => new Set(config?.product_ids ?? []), [config])

  // Кандидаты: новые активные товары, которых ещё нет в подборке. Без запроса — сразу PlayStation.
  const candidates = useMemo(() => {
    const pool = products.filter(p => !pickedIds.has(p.id) && p.condition !== 'used')
    const q = query.trim()
    const list = q
      ? rankSearch(pool, q, p => p.name, p => `${p.brand ?? ''} ${p.sku ?? ''}`)
      : pool.filter(p => PS_PATTERN.test(p.name))
    return list.slice(0, 40)
  }, [products, pickedIds, query])
  const allPlaystations = useMemo(
    () => products.filter(p => !pickedIds.has(p.id) && p.is_active && p.condition !== 'used' && PS_PATTERN.test(p.name) && /консол|console|приставк/i.test(p.name)),
    [products, pickedIds],
  )

  const setIds = (ids: string[], message?: string) => save({ product_ids: ids }, message)
  const add = (id: string) => config && setIds([...config.product_ids, id])
  const remove = (id: string) => config && setIds(config.product_ids.filter(x => x !== id))
  const move = (id: string, dir: -1 | 1) => {
    if (!config) return
    const ids = [...config.product_ids]
    const i = ids.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setIds(ids)
  }
  const addAllPlaystations = () => {
    if (!config || allPlaystations.length === 0) return
    setIds([...config.product_ids, ...allPlaystations.map(p => p.id)],
      `Добавлено: ${allPlaystations.length} ${pluralRu(allPlaystations.length, 'консоль', 'консоли', 'консолей')}`)
  }

  const trailerDirty = config !== null && trailerUrl.trim() !== (config.trailer_url ?? '')
  const trailerBad = trailerUrl.trim() !== '' && parseVideoUrl(trailerUrl) === null
  const giftDirty = config !== null && (giftTitle.trim() !== config.gift_title || giftText.trim() !== config.gift_text)

  const pickFile = (slot: Gta6Slot) => { pendingSlot.current = slot; fileInput.current?.click() }
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0]
    const slot = pendingSlot.current
    e.target.value = ''
    if (!raw || !slot) return
    setUploading(slot)
    try {
      const file = await compressImage(raw, slot === 'hero' ? 2200 : 1400)
      const body = new FormData()
      body.append('file', file)
      const res = await api(`/images/${slot}`, { method: 'POST', body })
      if (!res.ok) { toast(`Не удалось загрузить картинку (ошибка ${res.status})`, 'error'); return }
      const data: { url: string } = await res.json()
      setImages(prev => ({ ...prev, [slot]: data.url }))
      toast('Картинка загружена', 'success')
    } catch { toast('Нет связи с сервером', 'error') }
    finally { setUploading(null) }
  }
  const removeImage = async (slot: Gta6Slot) => {
    if (!(await confirmDialog({ title: 'Убрать картинку?', message: 'В блок вернётся стандартная картинка.', confirmLabel: 'Убрать' }))) return
    const ok = await call<object>(api, `/images/${slot}`, { method: 'DELETE' })
    if (!ok) return
    setImages(prev => { const next = { ...prev }; delete next[slot]; return next })
  }

  if (!config) {
    return <div className={`${CARD} flex items-center gap-3 text-slate-300`}><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />Загружаем раздел…</div>
  }

  const hiddenPicked = picked.filter(p => !p.is_active).length

  return (
    <div className="space-y-5" data-gta6-admin>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />

      {/* Показ на сайте */}
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className={LABEL}>Показ на сайте</div>
            <p className="mt-1 text-sm text-slate-400">
              {config.enabled
                ? 'Страница открыта покупателям по адресу /gta6.'
                : 'Страница выключена: покупатели её не видят, пункта в меню и блока на главной нет.'}
            </p>
          </div>
          <a href={config.enabled ? '/gta6' : '/gta6?preview=1'} target="_blank" rel="noreferrer" className={BTN_SECONDARY} data-testid="gta6-open">
            <AdminIcon name="external" className="h-4 w-4" />
            {config.enabled ? 'Открыть страницу' : 'Посмотреть черновик'}
          </a>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Toggle testId="gta6-enabled" checked={config.enabled} disabled={saving} label="Страница GTA VI включена"
            hint="Главный переключатель раздела"
            onChange={v => save({ enabled: v }, v ? 'Страница GTA VI открыта на сайте' : 'Страница GTA VI скрыта с сайта')} />
          <Toggle testId="gta6-gift" checked={config.gift_enabled} disabled={saving} label="Игра в подарок"
            hint="Плашка «GTA VI в подарок» на карточках и блок с условиями"
            onChange={v => save({ gift_enabled: v }, v ? 'Подарок показывается на странице' : 'Упоминания подарка скрыты')} />
          <Toggle testId="gta6-menu" checked={config.menu_link} disabled={saving || !config.enabled} label="Выделенный пункт «GTA VI» в меню"
            hint="Яркая кнопка в шапке сайта и строка в мобильном меню"
            onChange={v => save({ menu_link: v }, v ? 'Пункт «GTA VI» добавлен в меню' : 'Пункт «GTA VI» убран из меню')} />
          <Toggle testId="gta6-home" checked={config.home_banner} disabled={saving || !config.enabled} label="Блок-анонс на главной"
            hint="Большая карточка под слайдером баннеров"
            onChange={v => save({ home_banner: v }, v ? 'Анонс показывается на главной' : 'Анонс убран с главной')} />
        </div>
      </div>

      {/* Подарок */}
      <div className={CARD}>
        <div className={LABEL}>Условия подарка</div>
        <p className="mt-1 text-sm text-slate-400">Показываются в блоке перед подборкой консолей. Пустое поле — стандартный текст.</p>
        <div className="mt-4 space-y-3">
          <input className={INPUT} value={giftTitle} maxLength={120} onChange={e => setGiftTitle(e.target.value)}
            placeholder={GTA6_DEFAULT_GIFT_TITLE} data-testid="gta6-gift-title" />
          <textarea className={`${INPUT} min-h-[110px] resize-y`} value={giftText} maxLength={600} onChange={e => setGiftText(e.target.value)}
            placeholder={GTA6_DEFAULT_GIFT_TEXT} data-testid="gta6-gift-text" />
          <div className="flex items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={!giftDirty || saving} data-testid="gta6-gift-save"
              onClick={() => save({ gift_title: giftTitle.trim(), gift_text: giftText.trim() }, 'Условия подарка сохранены')}>
              Сохранить
            </button>
            {giftDirty && <span className="text-xs text-slate-500">Есть несохранённые изменения</span>}
          </div>
        </div>
      </div>

      {/* Ролик */}
      <div className={CARD}>
        <div className={LABEL}>Главный ролик</div>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          По умолчанию на странице три официальных ролика Rockstar Games с YouTube. Здесь можно поставить свой главный ролик:
          ссылка на YouTube, RuTube, VK Видео или прямая ссылка на файл mp4.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input className={`${INPUT} min-w-0 flex-1`} value={trailerUrl} maxLength={300} onChange={e => setTrailerUrl(e.target.value)}
            placeholder="https://rutube.ru/video/…" data-testid="gta6-trailer-url" />
          <button type="button" className={BTN_PRIMARY} disabled={!trailerDirty || saving || trailerBad} data-testid="gta6-trailer-save"
            onClick={() => save({ trailer_url: trailerUrl.trim() }, trailerUrl.trim() ? 'Ролик сохранён' : 'Возвращены официальные трейлеры')}>
            Сохранить
          </button>
        </div>
        {trailerBad && <div className="mt-2 text-xs text-amber-300">Не похоже на ссылку YouTube, RuTube, VK Видео или mp4 — проверьте адрес.</div>}
      </div>

      {/* Подборка товаров */}
      <div className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={LABEL}>Товары на странице</div>
            <p className="mt-1 text-sm text-slate-400">
              {picked.length === 0
                ? 'Подборка пуста — на странице вместо карточек будет приглашение позвонить.'
                : `${picked.length} ${pluralRu(picked.length, 'товар', 'товара', 'товаров')} · порядок на сайте — как здесь`}
              {hiddenPicked > 0 && <span className="text-amber-300"> · {hiddenPicked} скрыт{hiddenPicked === 1 ? '' : 'о'} в каталоге и на странице не показывается</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {allPlaystations.length > 0 && (
              <button type="button" className={BTN_SECONDARY} disabled={saving} onClick={addAllPlaystations} data-testid="gta6-add-all">
                <AdminIcon name="plus" className="h-4 w-4" />
                Добавить все PlayStation ({allPlaystations.length})
              </button>
            )}
            <button type="button" className={BTN_PRIMARY} onClick={onCreate} data-testid="gta6-create">
              <AdminIcon name="plus" className="h-4 w-4" />
              Создать новый товар
            </button>
          </div>
        </div>

        {picked.length > 0 && (
          <ul className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/10" data-testid="gta6-picked">
            {picked.map((p, i) => (
              <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${p.is_active ? '' : 'opacity-50'}`}>
                <span className="w-5 text-center text-xs tabular-nums text-slate-500">{i + 1}</span>
                <ProductThumb src={imageUrl(p.main_image_url)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {formatPrice(p.discount_price ?? p.price)}
                    {p.is_preorder ? ' · предзаказ' : p.stock_quantity > 0 ? ` · в наличии ${p.stock_quantity}` : ' · нет в наличии'}
                    {!p.is_active && ' · скрыт'}
                  </div>
                </div>
                <button type="button" className={BTN_ROW} onClick={() => onEdit(p)} aria-label="Открыть карточку товара"><AdminIcon name="edit" className="h-4 w-4" /></button>
                <button type="button" className={BTN_ROW} disabled={saving || i === 0} onClick={() => move(p.id, -1)} aria-label="Выше"><AdminIcon name="arrowUp" className="h-4 w-4" /></button>
                <button type="button" className={BTN_ROW} disabled={saving || i === picked.length - 1} onClick={() => move(p.id, 1)} aria-label="Ниже"><AdminIcon name="arrowDown" className="h-4 w-4" /></button>
                <button type="button" className={`${BTN_ROW} hover:!bg-red-500/30`} disabled={saving} onClick={() => remove(p.id)} aria-label="Убрать из подборки"><AdminIcon name="x" className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <div className="relative">
            <AdminIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className={`${INPUT} pl-10`} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Найти товар по названию или артикулу" data-testid="gta6-search" />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Нажмите на товар, чтобы добавить его на страницу. Нужного товара ещё нет в каталоге — «Создать новый товар».{' '}
            {query.trim() ? 'Результаты поиска по всему каталогу' : 'Без запроса показаны товары PlayStation из каталога'}
          </div>
          {candidates.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
              {query.trim() ? 'Ничего не нашлось' : 'Товаров PlayStation в каталоге нет или все уже в подборке. Воспользуйтесь поиском, чтобы добавить любой другой товар.'}
            </div>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="gta6-candidates">
              {candidates.map(p => (
                <li key={p.id}>
                  <button type="button" disabled={saving} onClick={() => add(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-yellow-400/40 hover:bg-white/[0.07] disabled:opacity-50">
                    <ProductThumb src={imageUrl(p.main_image_url)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{p.name}</span>
                      <span className="block text-xs text-slate-500">{formatPrice(p.discount_price ?? p.price)}{!p.is_active && ' · скрыт в каталоге'}</span>
                    </span>
                    <AdminIcon name="plus" className="h-4 w-4 flex-shrink-0 text-yellow-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Картинки блоков */}
      <div className={CARD}>
        <div className={LABEL}>Картинки блоков</div>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Необязательно: в каждом блоке уже стоит официальный арт или снимок экрана из материалов Rockstar Games.
          Здесь можно заменить любой из них своей картинкой.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GTA6_SLOTS.map(slot => {
            const url = images[slot.id]
            return (
              <div key={slot.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]" data-gta6-slot={slot.id}>
                <div className="relative aspect-video bg-black/40">
                  <img src={url ? imageUrl(url) : gta6Asset(slot.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {!url && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">Стандартная</span>}
                  {uploading === slot.id && <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">Загрузка…</span>}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm text-white">{slot.label}</div>
                  <div className="truncate text-[11px] text-slate-500" title={slot.hint}>{slot.hint}</div>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" className={`${BTN_ROW} flex-1 !px-2 text-xs`} disabled={uploading !== null} onClick={() => pickFile(slot.id)}>
                      {url ? 'Заменить' : 'Загрузить'}
                    </button>
                    {url && (
                      <button type="button" className={`${BTN_ROW} !px-2`} disabled={uploading !== null} onClick={() => removeImage(slot.id)} aria-label="Убрать картинку">
                        <AdminIcon name="trash" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ProductThumb({ src }: { src: string }) {
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" /> : <AdminIcon name="box" className="h-5 w-5 text-slate-400" />}
    </span>
  )
}
