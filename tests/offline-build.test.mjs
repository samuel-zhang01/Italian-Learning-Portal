import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { offlineBuild } from '../scripts/offline-build.ts';
function fixture() {
  const emitted = [];
  offlineBuild().generateBundle.call({ emitFile: asset => emitted.push(asset) }, {}, {
    'index.html': { type: 'asset', source: '<html>public app</html>' },
    'assets/main-abc.js': { type: 'chunk', code: 'export default 1' },
    'materials/book.pdf': { type: 'asset', source: 'private' },
  });
  const handlers = {}, requests = [], deleted = [];
  const cache = { addAll: async urls => requests.push(...urls), match: async key => ({ cached: key }) };
  const context = {
    self: { location: { origin: 'https://app.test' }, clients: { claim: async () => {} }, addEventListener: (kind, fn) => handlers[kind] = fn },
    caches: { open: async () => cache, keys: async () => ['another-app', 'parliamo-public-old'], delete: async key => deleted.push(key) },
    URL, Set, fetch: async () => { requests.push('NETWORK'); return { network: 'newer release' }; },
  };
  vm.runInNewContext(emitted.find(e => e.fileName === 'offline-worker.js').source, context);
  return { handlers, requests, deleted, emitted };
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
