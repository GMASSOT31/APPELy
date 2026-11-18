/*
 * Service worker Appely (lot 6) — volontairement prudent :
 * - ne met en cache QUE la coquille de l'application (page HTML, scripts et styles versionnés, icônes) ;
 * - ne touche JAMAIS aux appels /api/ : aucune donnée d'élève, de classe ou de compte n'est stockée ici ;
 * - pages : réseau d'abord, coquille en cache seulement si le réseau est coupé (l'application affiche
 *   alors « Pas de connexion ») ; fichiers /assets/ (noms uniques à chaque version) : cache d'abord.
 * Le mode hors ligne nominatif (liste d'élèves consultable sans réseau) n'est pas activé : voir README.
 */
const SHELL = 'appely-shell-v1'
const ASSETS = 'appely-assets-v1'
const PRECACHE = ['/', '/manifest.webmanifest', '/launch.css', '/favicon.svg', '/icons/icon-192.png']
const MAX_ASSETS = 60

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function trim(cacheName, max) {
  const c = await caches.open(cacheName)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i])
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // jamais de cache des données

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/', { cacheName: SHELL }).then((r) => r || Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req, { cacheName: ASSETS }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches
                .open(ASSETS)
                .then((c) => c.put(req, copy))
                .then(() => trim(ASSETS, MAX_ASSETS))
            }
            return res
          }),
      ),
    )
    return
  }

  if (PRECACHE.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req, { cacheName: SHELL }).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(SHELL).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit || Response.error())
        return hit || net
      }),
    )
  }
})
