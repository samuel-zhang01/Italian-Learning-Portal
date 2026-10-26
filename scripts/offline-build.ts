import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export function offlineReleaseVersion(input: {
  icon: string; manifest: string; workerTemplate: string;
  publicFiles: readonly { path: string; source: string | Uint8Array }[];
}) {
  const hash = createHash("sha256").update("icon\0").update(input.icon)
    .update("\0manifest\0").update(input.manifest).update("\0worker\0").update(input.workerTemplate);
  for (const file of [...input.publicFiles].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    hash.update("\0file\0").update(file.path).update("\0").update(file.source);
  }
  return hash.digest("hex").slice(0, 16);
}

// Only emitted public app assets enter this cache. No runtime URL discovery,
// private PDFs, local audio, learner records, or external requests are cached.
export function offlineBuild(): Plugin {
  return {
    name: "parliamo-offline",
    apply: "build",
    enforce: "post",
    generateBundle: { order: "post", handler(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") throw new Error("offline-index-missing");
      // Hash the public shell before inserting its derived version. Removing an
      // earlier injected tag also keeps repeated generation deterministic.
      const html = (typeof index.source === "string" ? index.source : Buffer.from(index.source).toString("utf8"))
        .replace(/<meta\b[^>]*\bname\s*=\s*(?:"parliamo-offline-version"|'parliamo-offline-version'|parliamo-offline-version(?=\s|\/?>))[^>]*>/gi, "");
      if (!/<\/head\s*>/i.test(html)) throw new Error("offline-index-head");
      const icon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
      this.emitFile({ type: "asset", fileName: "app-icon.svg", source: icon });
      const manifest = JSON.stringify({
        id: "/", name: "Parliamo", short_name: "Parliamo", start_url: "/#today", scope: "/",
        display: "standalone", background_color: "#f4ecdb", theme_color: "#193e2d",
        icons: [{ src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      });
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
      const files = Object.keys(bundle).filter(name => /^(index\.html|assets\/[A-Za-z0-9_-]+\.(js|css|webp|svg|woff2?))$/.test(name)).sort();
      const urls = ["/", ...files.filter(n => n !== "index.html").map(n => "/" + n), "/app-icon.svg", "/favicon.svg", "/manifest.webmanifest"];
      const workerTemplate = `
const CACHE = 'parliamo-public-__PARLIAMO_OFFLINE_RELEASE__';
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
`;
      const version = offlineReleaseVersion({ icon, manifest, workerTemplate, publicFiles: files.map(name => {
        const item = bundle[name];
        return { path: name, source: name === "index.html" ? html : item.type === "chunk" ? item.code : item.source };
      }) });
      index.source = html.replace(/<\/head\s*>/i, closing => `<meta name="parliamo-offline-version" content="${version}">${closing}`);
      this.emitFile({ type: "asset", fileName: "offline-worker.js", source: workerTemplate.replace("__PARLIAMO_OFFLINE_RELEASE__", version) });
    } },
  };
}
