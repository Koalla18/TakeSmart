// Запросы раздела «Приложения на iPhone» из админки: ошибки показываются тостом.
import { toast } from '../../lib/toast'
import { errorText } from '../../lib/installs'

export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>
export type Api = (path: string, init?: RequestInit) => Promise<Response>

export function copyText(text: string, msg: string) {
  navigator.clipboard?.writeText(text).then(() => toast(msg, 'success'), () => toast('Не удалось скопировать', 'error'))
}

export const readError = errorText

/** JSON-запрос к разделу: возвращает данные или показывает ошибку и отдаёт null. */
export async function call<T>(api: Api, path: string, init?: { method?: string; body?: unknown }): Promise<T | null> {
  try {
    const res = await api(path, {
      method: init?.method || 'GET',
      ...(init?.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
    })
    if (!res.ok) { toast(await errorText(res), 'error'); return null }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T)
  } catch {
    toast('Нет связи с сервером', 'error')
    return null
  }
}
