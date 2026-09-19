// Сервис-воркер СтатКарты (PWA, NFR-01): приложение и данные кэшируются при первом открытии и дальше
// работают без сети. Сведения дел сюда не попадают – они только в зашифрованном хранилище.
// Новая версия кэша появляется с каждой публикацией; старая удаляется при активации.
const CACHE = '__CACHE__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // сведения о версии – всегда из сети (проверка обновлений), остальное – из кэша
  if (url.pathname.endsWith('/version.json')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});
