import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { offlineBuild, offlineReleaseVersion } from '../scripts/offline-build.ts';
function fixture(input) {
  const emitted = [];
  const bundle = input ?? {
    'index.html': { type: 'asset', source: '<html><head></head><body>public app</body></html>' },
    'assets/main-abc.js': { type: 'chunk', code: 'export default 1' },
    'materials/book.pdf': { type: 'asset', source: 'private' },
  };
  offlineBuild().generateBundle.handler.call({ emitFile: asset => emitted.push(asset) }, {}, bundle);
  const handlers = {}, requests = [], deleted = [];
  const cache = { addAll: async urls => requests.push(...urls), match: async key => ({ cached: key }) };
  const context = {
    self: { location: { origin: 'https://app.test' }, clients: { claim: async () => {} }, addEventListener: (kind, fn) => handlers[kind] = fn },
    caches: { open: async () => cache, keys: async () => ['another-app', 'parliamo-public-old'], delete: async key => deleted.push(key) },
    URL, Set, fetch: async () => { requests.push('NETWORK'); return { network: 'newer release' }; },
  };
  vm.runInNewContext(emitted.find(e => e.fileName === 'offline-worker.js').source, context);
  return { handlers, requests, deleted, emitted, bundle };
}
const release = (f) => f.emitted.find(e => e.fileName === 'offline-worker.js').source.match(/parliamo-public-([a-f0-9]{16})/)[1];
function offlineRuntime(globals = {}) {
  // Compile the actual TSX module; helpers are exercised without a DOM, React
  // rendering, service-worker installation or network access.
  const source = readFileSync(new URL('../app/learning/offline.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, ...globals, require: name => {
    if (name === 'react' || name === 'react/jsx-runtime') return {};
    throw new Error('Unexpected offline runtime import');
  } });
  return exports;
}
test('offline download includes only public emitted assets and preserves unrelated caches', async () => {
  const f = fixture(); let pending;
  f.handlers.install({waitUntil: p => pending = p}); await pending;
  assert.ok(f.requests.includes('/assets/main-abc.js'));
  assert.ok(!f.requests.some(p => p.includes('book') || p.includes('materials')));
  f.handlers.activate({waitUntil: p => pending = p}); await pending;
  assert.deepEqual(f.deleted, ['parliamo-public-old']);
});
test('offline worker never handles private, remote, query or mutation requests', () => {
  const {handlers} = fixture();
  for (const request of [
    {url:'https://app.test/private.pdf',method:'GET'},
    {url:'https://other.test/assets/main-abc.js',method:'GET'},
    {url:'https://app.test/assets/main-abc.js?secret=1',method:'GET'},
    {url:'https://app.test/?parliamo-offline-release=synthetic',method:'GET',mode:'cors'},
    {url:'https://app.test/',method:'POST',mode:'navigate'},
    {url:'https://app.test/materials/book.pdf',method:'GET',mode:'navigate'},
  ]) handlers.fetch({request,respondWith:()=>assert.fail('Request must remain outside offline cache')});
});
test('offline root navigation stays pinned to the cached release even online; public chunks remain available', async () => {
  const {handlers,requests} = fixture();
  for(const request of [{url:'https://app.test/',method:'GET',mode:'navigate'}, {url:'https://app.test/assets/main-abc.js',method:'GET'}]) {
    let response; handlers.fetch({request,respondWith:p=>response=p});
    assert.equal((await response).cached,new URL(request.url).pathname);
    assert.ok(!requests.includes('NETWORK'), 'A newer online shell must not replace the downloaded release implicitly');
  }
});
test('the shell contains exactly one release meta matching its worker cache, without a circular hash', () => {
  const first = fixture(), version = release(first), html = first.bundle['index.html'].source;
  assert.match(html, new RegExp(`<meta name="parliamo-offline-version" content="${version}">`));
  assert.equal((html.match(/name="parliamo-offline-version"/g) ?? []).length, 1);
  const repeat = fixture(first.bundle);
  assert.equal(release(repeat), version); assert.equal(repeat.bundle['index.html'].source, html);
  const reordered = fixture(Object.fromEntries(Object.entries(first.bundle).reverse()));
  assert.equal(release(reordered), version); assert.equal(reordered.bundle['index.html'].source, html);
});
test('a changed public payload rotates release metadata while private excluded files do not', () => {
  const original = fixture(), version = release(original), bundle = structuredClone(original.bundle);
  bundle['materials/book.pdf'].source = 'different private source';
  assert.equal(release(fixture(bundle)), version);
  bundle['assets/main-abc.js'].code = 'export default 2';
  const changed = fixture(bundle); assert.notEqual(release(changed), version);
  assert.match(changed.bundle['index.html'].source, new RegExp(`content="${release(changed)}"`));
});
test('release identity covers the emitted worker template and manifest, and the hook runs after HTML generation', () => {
  const f = fixture(), version = release(f), worker = f.emitted.find(e => e.fileName === 'offline-worker.js').source;
  const input = {
    icon: f.emitted.find(e => e.fileName === 'app-icon.svg').source,
    manifest: f.emitted.find(e => e.fileName === 'manifest.webmanifest').source,
    workerTemplate: worker.replace(`parliamo-public-${version}`, 'parliamo-public-__PARLIAMO_OFFLINE_RELEASE__'),
    publicFiles: [
      { path: 'index.html', source: f.bundle['index.html'].source.replace(/<meta name="parliamo-offline-version" content="[a-f0-9]{16}">/, '') },
      { path: 'assets/main-abc.js', source: f.bundle['assets/main-abc.js'].code },
    ],
  };
  assert.equal(offlineReleaseVersion(input), version, 'The version must describe the bytes actually emitted');
  assert.notEqual(offlineReleaseVersion({ ...input, workerTemplate: input.workerTemplate + '\n// changed worker policy' }), version);
  assert.notEqual(offlineReleaseVersion({ ...input, manifest: input.manifest.replace('Parliamo', 'Parliamo updated') }), version);
  assert.equal(offlineBuild().generateBundle.order, 'post');
  assert.equal(offlineBuild().enforce, 'post');
});
test('registration uses the validated shell release and legacy or invalid metadata falls back to canonical', () => {
  const { offlineWorkerScriptUrl } = offlineRuntime();
  assert.equal(offlineWorkerScriptUrl('0123456789abcdef'), '/offline-worker.js?release=0123456789abcdef');
  for (const value of [null, undefined, '', 'ABCDEF0123456789', 'short', '0123456789abcdef&other=1', '//other.test/worker.js']) {
    assert.equal(offlineWorkerScriptUrl(value), '/offline-worker.js');
  }
});
test('recognition and removal accept canonical and queried same-origin workers, rejecting other origins and paths', () => {
  const { isOfflineWorkerScript } = offlineRuntime(), origin = 'https://app.test';
  for (const value of [origin + '/offline-worker.js', origin + '/offline-worker.js?release=0123456789abcdef']) assert.equal(isOfflineWorkerScript(value, origin), true);
  for (const value of [undefined, '', '/offline-worker.js', 'invalid', 'https://other.test/offline-worker.js', origin + '/other/offline-worker.js', origin + '/offline-worker.js.backup']) assert.equal(isOfflineWorkerScript(value, origin), false);
});
function releaseRuntime(metas, { ok = true, mime = 'text/html; charset=utf-8', html = '<html>synthetic release</html>', failure } = {}) {
  const calls = [];
  const globals = {
    crypto: { randomUUID: () => 'synthetic-nonce' },
    fetch: async (url, options) => { calls.push({ url, options }); if (failure) throw failure; return { ok, headers: { get: () => mime }, text: async () => html }; },
    DOMParser: class { parseFromString(source, type) { assert.equal(source, html); assert.equal(type, 'text/html'); return { querySelectorAll: selector => { assert.equal(selector, 'meta[name="parliamo-offline-version"]'); return metas.map(content => ({ content })); } }; } },
  };
  return { ...offlineRuntime(globals), calls };
}
test('an old pinned shell discovers the fresh network release through an uncached ordinary query before registering', async () => {
  const { latestOfflineWorkerScriptUrl, calls } = releaseRuntime(['fedcba9876543210']);
  assert.equal(await latestOfflineWorkerScriptUrl('0123456789abcdef'), '/offline-worker.js?release=fedcba9876543210');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/?parliamo-offline-release=synthetic-nonce');
  assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.redirect, 'error');
});
test('only successful legacy HTML may fall back; network, invalid metadata and unexpected responses cannot claim an update check', async () => {
  const legacy = releaseRuntime([]);
  assert.equal(await legacy.latestOfflineWorkerScriptUrl('0123456789abcdef'), '/offline-worker.js?release=0123456789abcdef');
  assert.equal(await legacy.latestOfflineWorkerScriptUrl(undefined), '/offline-worker.js');
  for (const fixture of [
    releaseRuntime(['invalid']), releaseRuntime(['0123456789abcdef', 'fedcba9876543210']),
    releaseRuntime([], { failure: new Error('offline') }), releaseRuntime([], { ok: false }),
    releaseRuntime([], { mime: 'application/json' }), releaseRuntime([], { html: 'x'.repeat(1_000_001) }),
  ]) await assert.rejects(() => fixture.latestOfflineWorkerScriptUrl('0123456789abcdef'));
});
