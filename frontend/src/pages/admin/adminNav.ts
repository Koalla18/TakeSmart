/**
 * Карта разделов админки v2.
 *
 * Идея версии: вместо девяти равнозначных вкладок в ряд — три смысловые группы
 * в боковой навигации (Продажи / Каталог / Витрина) и один раздел на экране.
 * «Поля и варианты» и «Модели» — это настройки категорий, поэтому в навигации
 * их нет: они живут вкладками внутри раздела «Категории» (navId ниже).
 * Разделы 'slides' и 'used' скрыты из меню, но по адресу ?tab= открываются.
 */
import type { AdminIconName } from './AdminIcons'

export type AdminSection =
  | 'overview' | 'orders' | 'analytics'
  | 'products' | 'categories' | 'fields' | 'quickfilters' | 'brands'
  | 'banners' | 'tradein' | 'slides' | 'used'

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  'overview', 'orders', 'analytics', 'products', 'categories', 'fields', 'quickfilters', 'brands', 'banners', 'tradein', 'slides', 'used',
]

export function isAdminSection(value: string | null | undefined): value is AdminSection {
  return Boolean(value) && (ADMIN_SECTIONS as readonly string[]).includes(value as string)
}

export interface AdminNavItem {
  id: AdminSection
  label: string
  icon: AdminIconName
  /** Короткая подсказка в палитре поиска и на мобильном меню */
  hint: string
}

export interface AdminNavGroup {
  /** null — группа без заголовка (Обзор) */
  label: string | null
  items: AdminNavItem[]
}

export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ id: 'overview', label: 'Обзор', icon: 'home', hint: 'Что требует внимания сегодня' }] },
  {
    label: 'Продажи',
    items: [
      { id: 'orders', label: 'Заказы', icon: 'orders', hint: 'Новые, в работе, отправленные' },
      { id: 'analytics', label: 'Аналитика', icon: 'chart', hint: 'Выручка, визиты, конверсия' },
    ],
  },
  {
    label: 'Каталог',
    items: [
      { id: 'products', label: 'Товары', icon: 'box', hint: 'Карточки, группы, цены, наличие' },
      { id: 'categories', label: 'Категории', icon: 'folder', hint: 'Разделы, поля карточки, модели' },
      { id: 'brands', label: 'Бренды', icon: 'tag', hint: 'Справочник брендов и логотипы' },
    ],
  },
  {
    label: 'Витрина',
    items: [
      { id: 'banners', label: 'Баннеры', icon: 'image', hint: 'Слайдер на главной' },
      { id: 'tradein', label: 'Trade-in', icon: 'refresh', hint: 'Цены калькулятора оценки' },
    ],
  },
]

export interface AdminSectionMeta {
  title: string
  /** Надпись над заголовком — к какой группе относится экран */
  eyebrow?: string
  description?: string
  /** Какой пункт бокового меню подсвечивать (для вкладок внутри раздела) */
  navId: AdminSection
}

export const ADMIN_SECTION_META: Record<AdminSection, AdminSectionMeta> = {
  overview: { title: 'Обзор', navId: 'overview' },
  orders: { title: 'Заказы', eyebrow: 'Продажи', description: 'Клик по строке открывает заказ: состав, адрес, смена статуса', navId: 'orders' },
  analytics: { title: 'Аналитика', eyebrow: 'Продажи', navId: 'analytics' },
  products: { title: 'Товары', eyebrow: 'Каталог', description: 'Карточки товаров, группы вариантов, цены и наличие', navId: 'products' },
  categories: { title: 'Категории', eyebrow: 'Каталог', description: 'Разделы каталога: название, адрес, картинка, порядок и видимость на сайте', navId: 'categories' },
  fields: { title: 'Категории', eyebrow: 'Каталог', description: 'Схема карточки товара для каждой категории: характеристики и оси вариантов (память, цвет)', navId: 'categories' },
  quickfilters: { title: 'Категории', eyebrow: 'Каталог', description: 'Кнопки моделей над товарами в каталоге — например, iPhone 16 или Galaxy S25. Пустой список скрывает кнопки', navId: 'categories' },
  brands: { title: 'Бренды', eyebrow: 'Каталог', description: 'Справочник брендов для товаров и быстрых кнопок каталога. Логотипы показываются в меню сайта', navId: 'brands' },
  banners: { title: 'Баннеры', eyebrow: 'Витрина', description: 'Большой слайдер вверху главной. Порядок — стрелками, показ — переключателем «Активен»', navId: 'banners' },
  tradein: { title: 'Trade-in', eyebrow: 'Витрина', description: 'Диапазоны оценки устройств в калькуляторе на странице Trade-in', navId: 'tradein' },
  slides: { title: 'Слайды «Товары недели»', eyebrow: 'Витрина', description: 'Блок «Товары недели» на главной странице', navId: 'banners' },
  used: { title: 'Б/У товары', eyebrow: 'Каталог', description: 'Товары с пробегом — отдельный раздел витрины', navId: 'products' },
}

/** Вкладки внутри раздела «Категории» */
export const CATEGORY_SEGMENTS: { id: AdminSection; label: string }[] = [
  { id: 'categories', label: 'Список' },
  { id: 'fields', label: 'Поля и варианты' },
  { id: 'quickfilters', label: 'Модели в каталоге' },
]
