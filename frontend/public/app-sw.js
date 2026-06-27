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
  const title = data.title || 'Новый заказ'
  const options = {
    body: data.body || '',
    icon: '/app-icon.svg',
    badge: '/app-icon.svg',
    tag: data.tag || 'takesmart-order',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || '/app' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
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
