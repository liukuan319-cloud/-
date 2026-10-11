/* Built from the current Vite assets. API caches contain one signed-in identity at a time. */
const VERSION = '__PWA_VERSION__';
const APP_CACHE = `banshu-app-${VERSION}`;
const DATA_CACHE = `banshu-data-${VERSION}`;
const ASSETS = __PWA_ASSETS__;
const READ_PATHS = new Set([
  '/api/notices', '/api/tasks', '/api/class/schedule', '/api/calendar',
  '/api/personal-tasks', '/api/votes', '/api/members',
]);
const SESSION_KEY = '/__pwa/session';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('banshu-app-') && name !== APP_CACHE).map(name => caches.delete(name)));
    // Data from an older application version may have a different shape.
    await Promise.all(names.filter(name => name.startsWith('banshu-data-') && name !== DATA_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function clearData() {
  await caches.delete(DATA_CACHE);
}

async function savedSession() {
  const cache = await caches.open(DATA_CACHE);
  const response = await cache.match(SESSION_KEY);
  return response ? response.json().catch(() => null) : null;
}

async function storeSession(response) {
  const incoming = await response.clone().json().catch(() => null);
  if (!incoming?.user?.id || !incoming?.classroom?.id) return;
  const previous = await savedSession();
  if (previous && (previous.user.id !== incoming.user.id || previous.classroom.id !== incoming.classroom.id)) await clearData();
  const cache = await caches.open(DATA_CACHE);
  await cache.put(SESSION_KEY, new Response(JSON.stringify(incoming), { headers: { 'Content-Type': 'application/json' } }));
}

async function sessionRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await storeSession(response);
    else if (response.status === 401 || response.status === 403) await clearData();
    return response;
  } catch {
    const session = await savedSession();
    return session
      ? new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json', 'X-Banshu-Offline': '1' } })
      : new Response(JSON.stringify({ error: '离线时没有已保存的登录数据，请联网后重试。' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function readRequest(request) {
  const cache = await caches.open(DATA_CACHE);
  const session = await savedSession();
  if (!session) return fetch(request);
  const identity = `${session.classroom.id}:${session.user.id}`;
  const key = new Request(`${request.url}${request.url.includes('?') ? '&' : '?'}__pwa_identity=${encodeURIComponent(identity)}`);
  const cached = await cache.match(key);
  const update = fetch(request).then(async response => {
    const current = await savedSession();
    if (response.ok && current?.classroom?.id === session.classroom.id && current?.user?.id === session.user.id && (response.headers.get('Content-Type') || '').includes('application/json')) await cache.put(key, response.clone());
    else if (response.status === 401 || response.status === 403) await clearData();
    return response;
  });
  try { return await update; }
  catch {
    return cached || new Response(JSON.stringify({ error: '离线时尚未缓存此页面的数据，请联网打开一次。' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api/session') {
    if (request.method === 'GET') event.respondWith(sessionRequest(request));
    else if (request.method === 'DELETE') event.respondWith(fetch(request).then(async response => { if (response.ok) await clearData(); return response; }));
    return;
  }
  if (request.method === 'POST' && ['/api/login', '/api/activate', '/api/classes', '/api/demo/session'].includes(url.pathname)) {
    event.respondWith(fetch(request).then(async response => { if (response.ok) await storeSession(response); return response; }));
    return;
  }
  if (request.method === 'GET' && READ_PATHS.has(url.pathname)) {
    event.respondWith(readRequest(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(APP_CACHE)).match('/index.html') || Response.error()));
  }
});
