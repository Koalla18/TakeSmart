/* TakeSmart «Заказы» — service worker.
   Только Web Push + клик по уведомлению. НЕ кэширует и НЕ перехватывает fetch,
   чтобы не влиять на работу основного сайта. */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'У вас новый заказ!'
  const kind = data.kind || 'order'
  const options = {
    body: data.body || '',
    icon: data.icon || '/app-icon-192.png',
    badge: '/app-icon-192.png',
    tag: data.tag || 'takesmart-order',
    renotify: true,
    requireInteraction: true,
    // Ошибка Авито — другой ритм вибрации (Android), чтобы отличать от заказа на ощупь
    vibrate: kind === 'avito_error' ? [400, 150, 400, 150, 400] : [180, 80, 180],
    data: { url: data.url || '/app', kind },
  }
  // Открытое приложение играет свой звук для этого вида уведомления
  const tellPages = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: 'push', kind, title })))
    .catch(() => {})
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), tellPages]))
})

// ── Фоновая переподписка ────────────────────────────────────────────────────
// Браузер периодически меняет push-подписку (pushsubscriptionchange). Без этого
// обработчика подписка на сервере «протухает» и уведомления тихо перестают
// приходить при закрытом приложении. Токен берём из IndexedDB (его кладёт страница).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
function idbGetToken() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('takesmart-app', 1)
      req.onupgradeneeded = () => { try { req.result.createObjectStore('kv') } catch (e) { /* */ } }
      req.onsuccess = () => {
        try {
          const db = req.result
          const tx = db.transaction('kv', 'readonly')
          const g = tx.objectStore('kv').get('authToken')
          g.onsuccess = () => { resolve(g.result || null); db.close() }
          g.onerror = () => { resolve(null); try { db.close() } catch (e) { /* */ } }
        } catch (e) { resolve(null) }
      }
      req.onerror = () => resolve(null)
    } catch (e) { resolve(null) }
  })
}
async function resubscribe() {
  try {
    const res = await fetch('/api/push/vapid-public-key')
    if (!res.ok) return
    const data = await res.json()
    if (!data || !data.public_key) return
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.public_key),
    })
    const j = sub.toJSON()
    if (!j.endpoint || !j.keys) return
    const token = await idbGetToken()
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, user_agent: 'sw-resubscribe' }),
    })
  } catch (e) { /* */ }
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/app'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/app') && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
