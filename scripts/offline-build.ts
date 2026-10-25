import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

// Only emitted public app assets enter this cache. No runtime URL discovery,
// private PDFs, local audio, learner records, or external requests are cached.
export function offlineBuild(): Plugin {
  return {
    name: "parliamo-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      const icon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
      this.emitFile({ type: "asset", fileName: "app-icon.svg", source: icon });
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify({
        id: "/", name: "Parliamo", short_name: "Parliamo", start_url: "/#today", scope: "/",
        display: "standalone", background_color: "#f4ecdb", theme_color: "#193e2d",
        icons: [{ src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      }) });
      const files = Object.keys(bundle).filter(name => /^(index\.html|assets\/[A-Za-z0-9_-]+\.(js|css|webp|svg|woff2?))$/.test(name));
      const version = createHash("sha256").update(icon).update(files.map(name => {
        const item = bundle[name]; return name + (item.type === "chunk" ? item.code : String(item.source));
      }).join("\n")).digest("hex").slice(0, 16);
      const urls = ["/", ...files.filter(n => n !== "index.html").map(n => "/" + n), "/app-icon.svg", "/favicon.svg", "/manifest.webmanifest"];
      this.emitFile({ type: "asset", fileName: "offline-worker.js", source: `
const CACHE = 'parliamo-public-${version}';
const URLS = ${JSON.stringify(urls)};
const ALLOWED = new Set(URLS);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try { await cache.addAll(URLS); } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('parliamo-public-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    // Keep HTML and lazy chunks on one downloaded release until explicit activation.
    event.respondWith((async () => (await (await caches.open(CACHE)).match('/')) || fetch(request))());
  } else if (!url.search && ALLOWED.has(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(request))());
  }
});
` });
    },
  };
}
