import { useEffect, useState } from 'react'
import { API_BASE_URL } from './config'
import { fetchPreorderSettings } from './preorder'
import type { ApiProductOut } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// Страница GTA VI (/gta6): рассказ об игре + подборка PlayStation 5 с игрой в
// подарок. Состав подборки, тексты подарка и картинки задаются в админке
// (раздел «GTA VI»), на витрину приходят одним запросом /api/gta6.
// ─────────────────────────────────────────────────────────────────────────────

/** Выход игры — полночь 19 ноября 2026 по Москве */
export const GTA6_RELEASE = new Date('2026-11-19T00:00:00+03:00')
export const GTA6_RELEASE_LABEL = '19 ноября 2026'

export const GTA6_DEFAULT_GIFT_TITLE = 'Покупаете PlayStation 5 — GTA VI дарим'
export const GTA6_DEFAULT_GIFT_TEXT =
  'К любой консоли из подборки ниже прилагается Grand Theft Auto VI в подарок. ' +
  'До выхода игры закрепим её за вашим заказом и передадим в день релиза, после 19 ноября — отдадим сразу вместе с консолью. ' +
  'Формат подарка (диск или цифровой код) менеджер подберёт под вашу модель PS5.'

/** Места под картинки на странице. Пустое место — стандартный официальный арт из public/gta6-art. */
export type Gta6Slot =
  | 'hero' | 'promo' | 'story' | 'jason' | 'lucia'
  | 'vice_city' | 'keys' | 'grassrivers' | 'port_gellhorn' | 'ambrosia' | 'kalaga' | 'finale'

export const GTA6_SLOTS: { id: Gta6Slot; label: string; hint: string }[] = [
  { id: 'hero', label: 'Первый экран', hint: 'Обложка, горизонтальная 16:9' },
  { id: 'promo', label: 'Большой баннер', hint: 'Во всю ширину, от 2400 px' },
  { id: 'story', label: 'Сюжет', hint: 'Горизонтальная 16:9' },
  { id: 'jason', label: 'Джейсон', hint: 'Горизонтальная 16:9' },
  { id: 'lucia', label: 'Лусия', hint: 'Горизонтальная 16:9' },
  { id: 'vice_city', label: 'Вайс-Сити', hint: 'Горизонтальная 16:9' },
  { id: 'keys', label: 'Леонида-Кис', hint: 'Горизонтальная 16:9' },
  { id: 'grassrivers', label: 'Грассриверс', hint: 'Горизонтальная 16:9' },
  { id: 'port_gellhorn', label: 'Порт-Геллхорн', hint: 'Горизонтальная 16:9' },
  { id: 'ambrosia', label: 'Амброзия', hint: 'Горизонтальная 16:9' },
  { id: 'kalaga', label: 'Гора Калага', hint: 'Горизонтальная 16:9' },
  { id: 'finale', label: 'Финальный экран', hint: 'Во всю ширину, от 2000 px' },
]

/**
 * Стандартная картинка блока (статика сайта). Папка намеренно НЕ называется «gta6»:
 * адрес страницы — /gta6, и одноимённая папка в статике заставляет nginx при прямом
 * заходе открывать её вместо сайта (301 на /gta6/ и 403).
 */
export function gta6Asset(name: string): string {
  return `/gta6-art/${name}.webp`
}

export interface Gta6Config {
  enabled: boolean
  menu_link: boolean
  home_banner: boolean
  gift_enabled: boolean
  gift_title: string
  gift_text: string
  /** Свой главный ролик; пусто — официальные трейлеры с YouTube */
  trailer_url: string
  product_ids: string[]
  images: Partial<Record<Gta6Slot, string>>
}

export const DEFAULT_GTA6_CONFIG: Gta6Config = {
  enabled: false, menu_link: true, home_banner: true, gift_enabled: true,
  gift_title: '', gift_text: '', trailer_url: '', product_ids: [], images: {},
}

export interface Gta6Page {
  enabled: boolean
  gift_enabled: boolean
  gift_title: string
  gift_text: string
  trailer_url?: string
  images: Partial<Record<Gta6Slot, string>>
  products: ApiProductOut[]
}

let pageCache: Promise<Gta6Page | null> | null = null

export function fetchGta6Page(): Promise<Gta6Page | null> {
  if (!pageCache) {
    pageCache = fetch(`${API_BASE_URL}/api/gta6`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Gta6Page) => data)
      .catch(() => {
        pageCache = null
        return null
      })
  }
  return pageCache
}

/** Где на сайте показывать раздел: те же публичные настройки, один запрос на страницу. */
export function useGta6Flags(): { menu: boolean; home: boolean } {
  const [flags, setFlags] = useState({ menu: false, home: false })
  useEffect(() => {
    let cancelled = false
    fetchPreorderSettings().then(settings => {
      if (!cancelled) setFlags({ menu: Boolean(settings.gta6_menu_enabled), home: Boolean(settings.gta6_home_enabled) })
    })
    return () => { cancelled = true }
  }, [])
  return flags
}

/** Сколько осталось до выхода; null — игра уже вышла */
export function timeToRelease(now: number = Date.now()): { days: number; hours: number; minutes: number; seconds: number } | null {
  const diff = GTA6_RELEASE.getTime() - now
  if (diff <= 0) return null
  const s = Math.floor(diff / 1000)
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}

/** Официальные ролики Rockstar Games на YouTube */
export const GTA6_TRAILERS: { id: string; title: string; poster: string }[] = [
  { id: 'tJbzMqJGH4k', title: 'Расширенный показ', poster: 'trailer-1' },
  { id: 'VQRLujxTm3c', title: 'Трейлер 2', poster: 'trailer-2' },
  { id: 'QdBZY2fkU-0', title: 'Трейлер 1', poster: 'trailer-3' },
]

export type Gta6Video = { kind: 'iframe' | 'file'; src: string }

export function youtubeEmbed(id: string): Gta6Video {
  return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` }
}

/** Ссылка из админки → то, что можно показать в плеере. null — ссылку не распознали. */
export function parseVideoUrl(raw: string): Gta6Video | null {
  const url = raw.trim()
  if (!url.startsWith('https://')) return null
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
  if (m) return youtubeEmbed(m[1])
  m = url.match(/rutube\.ru\/(?:video|play\/embed)\/([0-9a-f]{32})/)
  if (m) return { kind: 'iframe', src: `https://rutube.ru/play/embed/${m[1]}?autoplay=1` }
  m = url.match(/(?:vk\.com|vkvideo\.ru)\/(?:.*[?&]z=)?video(-?\d+)_(\d+)/)
  if (m) return { kind: 'iframe', src: `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2&autoplay=1` }
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return { kind: 'file', src: url }
  return null
}

/** Как подарок называется в корзине, заказе и у сотрудников */
export const GTA6_GIFT_NAME = 'Grand Theft Auto VI'

const NO_GIFTS: ReadonlySet<string> = new Set()

/**
 * Товары, к которым сейчас положена игра в подарок: подборка страницы /gta6, пока
 * включены и страница, и подарок. Окончательно подарок записывает в заказ сервер
 * по тому же правилу — здесь только показ покупателю в корзине и на странице товара.
 */
export function useGta6GiftIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NO_GIFTS)
  useEffect(() => {
    let cancelled = false
    fetchGta6Page().then(page => {
      if (cancelled || !page || !page.enabled || !page.gift_enabled) return
      setIds(new Set(page.products.map(p => p.id)))
    })
    return () => { cancelled = true }
  }, [])
  return ids
}
