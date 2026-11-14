/* Служебный работник плеера: нужен, чтобы плеер ставился как приложение и открывался без интернета.
   Плеер открывается сразу из сохранённой копии, не дожидаясь сети, а свежая версия подтягивается следом
   и сообщается странице (она перезапустится на неё сама или возьмёт при следующем запуске).
   Нейросети из ai/ (около 20 МБ) скачиваются один раз и дальше берутся только из сохранённого.
   Запросы к Яндекс.Диску не трогаем вовсе. */
const CACHE = 'player-shell-v2', HEAVY = 'player-ai-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== HEAVY).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function heavy(request) {                    // большие неизменные файлы: сохранённое, иначе сеть
  const cache = await caches.open(HEAVY);
  const hit = await cache.match(request);
  if (hit) return hit;
  const r = await fetch(request);
  if (r.ok) cache.put(request, r.clone());
  return r;
}
async function refresh(request, key, old) {        // свежая копия из сети — в сохранённое
  const r = await fetch(request);
  if (!r.ok) return r;
  const cache = await caches.open(CACHE);
  if (old && request.mode === 'navigate') {        // страница изменилась — говорим об этом открытому плееру
    const [a, b] = await Promise.all([old.clone().text(), r.clone().text()]);
    await cache.put(key, r.clone());
    if (a !== b) for (const c of await self.clients.matchAll()) c.postMessage({ type: 'updated' });
  } else await cache.put(key, r.clone());
  return r;
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/ai/')) return e.respondWith(heavy(e.request));
  const key = e.request.mode === 'navigate' ? './' : e.request;   // страница одна, с любыми ?параметрами
  e.respondWith((async () => {
    const old = await caches.match(key, { cacheName: CACHE });
    const fresh = refresh(e.request, key, old).catch(() => null);
    if (old) { e.waitUntil(fresh); return old.clone(); }
    return await fresh || Response.error();
  })());
});
