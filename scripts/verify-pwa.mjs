import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
const assets = new Map();
const cachesByName = new Map();
const events = new Map();
const offline = { value: false };
const fetch = async request => {
  if (offline.value) throw new TypeError('Network unavailable');
  const url = new URL(typeof request === 'string' ? request : request.url, 'https://banshu.test');
  return assets.get(url.pathname)?.clone() || new Response('missing', { status: 404 });
};
const caches = {
  keys: async () => [...cachesByName.keys()],
  delete: async name => cachesByName.delete(name),
  open: async name => {
    if (!cachesByName.has(name)) cachesByName.set(name, new Map());
    const entries = cachesByName.get(name);
    return {
      addAll: async urls => {
        for (const url of urls) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Precache failed: ${url}`);
          entries.set(new URL(url, 'https://banshu.test').href, response.clone());
        }
      },
      match: async request => entries.get(new URL(typeof request === 'string' ? request : request.url, 'https://banshu.test').href)?.clone(),
      put: async (request, response) => entries.set(new URL(typeof request === 'string' ? request : request.url, 'https://banshu.test').href, response.clone()),
    };
  },
};
const self = { location: { origin: 'https://banshu.test' }, addEventListener: (name, listener) => events.set(name, listener), skipWaiting: async () => {}, clients: { claim: async () => {} } };
vm.runInNewContext(source, { self, caches, fetch, Request, Response, URL, console });
const urls = [...source.matchAll(/"\/(?:index\.html|assets\/[^" ]+|icons\/[^" ]+|manifest\.webmanifest)"/g)].map(match => JSON.parse(match[0]));
for (const url of urls) assets.set(url, new Response(url, { status: 200 }));
assets.set('/', new Response('root', { status: 200 }));
let pending;
events.get('install')({ waitUntil: promise => pending = promise });
await pending;
offline.value = true;
for (const [path, mode, destination, expected] of [['/', 'navigate', 'document', '/index.html'], ['/class', 'navigate', 'document', '/index.html'], [urls.find(url => url.endsWith('.js')), 'cors', 'script', '.js'], [urls.find(url => url.endsWith('.css')), 'cors', 'style', '.css']]) {
  assert.ok(path, 'Built JS and CSS must be precached');
  const request = { url: new URL(path, 'https://banshu.test').href, method: 'GET', mode, destination };
  events.get('fetch')({ request, respondWith: promise => pending = promise });
  const response = await pending;
  assert.ok(response.ok, `Offline fetch ${path} must succeed`);
  assert.ok((await response.text()).includes(expected), `Offline fetch ${path} must use the cached app shell or asset`);
}
console.log('Offline navigation, reload assets, and app shell verified.');
