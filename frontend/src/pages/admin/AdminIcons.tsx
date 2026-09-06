/**
 * Иконки админки v2 — небольшой набор линейных SVG на currentColor.
 * Раньше разделы подписывались эмодзи: они по-разному рисуются в macOS/Windows
 * и пестрят. Один стиль штриха (1.8px) держит навигацию спокойной.
 */
import type { SVGProps } from 'react'

export type AdminIconName =
  | 'home' | 'orders' | 'chart' | 'box' | 'folder' | 'tag' | 'image' | 'refresh'
  | 'sliders' | 'zap' | 'search' | 'menu' | 'x' | 'logout' | 'external' | 'plus'
  | 'star' | 'eyeOff' | 'alert' | 'archive' | 'arrowRight' | 'check' | 'layers'
  | 'clock' | 'users' | 'ruble' | 'trending' | 'chevronRight' | 'settings' | 'sparkle'
  | 'edit' | 'trash' | 'eye' | 'arrowUp' | 'arrowDown' | 'link' | 'dock' | 'sidebar' | 'bolt'

const PATHS: Record<AdminIconName, string> = {
  home: 'M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  orders: 'M5 3h14v18l-2.5-1.8L14 21l-2-1.5L10 21l-2.5-1.8L5 21z M9 8h6 M9 12h6 M9 16h4',
  chart: 'M4 4v16h16 M8 14l3.5-3.5 3 3L20 8',
  box: 'M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z M3.5 7.5L12 12l8.5-4.5 M12 12v9',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  tag: 'M20.5 12.5L12.5 20.5 3.5 11.5V3.5h8l9 9z M7.5 7.5h.01',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M3 16.5l5-5 4 4 3-3 6 6 M16 9h.01',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1 M21 3.5v5h-5',
  sliders: 'M4 6h16 M4 12h16 M4 18h16 M14 4v4 M8 10v4 M16 16v4',
  zap: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-3.8-3.8',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  x: 'M6 6l12 12 M18 6L6 18',
  logout: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4 M9 16l4-4-4-4 M13 12H3',
  external: 'M14 4h6v6 M20 4l-9 9 M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  plus: 'M12 5v14 M5 12h14',
  star: 'M12 3l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.6l-5.7 2.9 1.1-6.3L2.8 9.7l6.4-.9z',
  eyeOff: 'M3 3l18 18 M10.6 10.6a2 2 0 0 0 2.8 2.8 M9.9 5.2A10.4 10.4 0 0 1 12 5c5 0 9 4 10 7a11 11 0 0 1-2.4 3.5 M6.5 6.5A11 11 0 0 0 2 12c1 3 5 7 10 7a10 10 0 0 0 4.3-1',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  archive: 'M3 4h18v4H3z M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8 M10 12h4',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  check: 'M5 12l5 5L20 7',
  layers: 'M12 3l9 4.5-9 4.5-9-4.5z M3 12l9 4.5 9-4.5 M3 16.5L12 21l9-4.5',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 7v5l3 2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9.5 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M21 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  ruble: 'M8 21V4h6a4 4 0 0 1 0 8H6 M6 16h8',
  trending: 'M3 17l6-6 4 4 8-8 M14 7h7v7',
  chevronRight: 'M9 6l6 6-6 6',
  settings: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12 M9 7V4h6v3',
  eye: 'M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  arrowUp: 'M12 19V5 M5 12l7-7 7 7',
  arrowDown: 'M12 5v14 M19 12l-7 7-7-7',
  link: 'M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2 M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
  dock: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z M8 15.5h8',
  sidebar: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z M9.5 4v16',
  bolt: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z',
}

interface AdminIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: AdminIconName
  className?: string
}

export function AdminIcon({ name, className = 'h-5 w-5', ...rest }: AdminIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
