// Offline app shell: the built app, its assets and map tiles already seen keep working without a connection.
// Data the app stores (trips, tickets, memories) lives in the browser or comes from the API when online.
const SHELL = 'delayproof-shell-v1'
const TILES = 'delayproof-tiles-v1'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    const root = new URL('./', self.registration.scope)
    const res = await fetch(root, { cache: 'reload' })
    if (!res.ok) throw new Error('Could not prepare the offline app')
    const html = await res.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map(([, a]) => new URL(a, root).href)
    await cache.addAll([...assets, new URL('icon.svg', root).href, new URL('manifest.webmanifest', root).href])
    await cache.put(root, res)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, TILES].includes(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

async function cacheFirst(cacheName, request, limit) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok || res.type === 'opaque') {
    await cache.put(request, res.clone())
    if (limit) {
      const keys = await cache.keys()
      if (keys.length > limit) await cache.delete(keys[0])
    }
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const scope = new URL(self.registration.scope)
  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname + 'api/')) return // live data: network only
  if (request.mode === 'navigate' && url.origin === scope.origin) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL)).match(scope.href)))
  } else if (url.origin === scope.origin && /\/(assets\/|icon\.svg|manifest\.webmanifest)/.test(url.pathname)) {
    event.respondWith(cacheFirst(SHELL, request))
  } else if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(TILES, request, 400))
  }
})
