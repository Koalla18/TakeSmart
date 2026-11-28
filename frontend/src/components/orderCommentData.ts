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

export function readStaffName(): string {
  try { return (localStorage.getItem(NAME_KEY) || '').trim() } catch { return '' }
}

export function storeStaffName(name: string) {
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
