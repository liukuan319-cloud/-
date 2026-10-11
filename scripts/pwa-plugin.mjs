import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export default function pwaWorker() {
  return {
    name: 'banshu-pwa-worker',
    apply: 'build',
    async writeBundle(_options, bundle) {
      const assets = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
        ...Object.values(bundle).map(item => `/${item.fileName}`).filter(path => /\.(?:js|css)$/.test(path))];
      const html = await readFile(new URL('../dist/index.html', import.meta.url));
      const version = createHash('sha256').update(assets.join('|')).update(html).digest('hex').slice(0, 12);
      const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8');
      await writeFile(new URL('../dist/sw.js', import.meta.url), template.replace('__PWA_VERSION__', version).replace('__PWA_ASSETS__', JSON.stringify(assets)));
    },
  };
}
