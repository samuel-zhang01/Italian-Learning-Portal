import test from "node:test";
import assert from "node:assert/strict";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { emptyProgress, emptyDraft } from "../app/learning/engine.ts";
import { mergeProfileProgress, sameProgress } from "../app/learning/profile-merge.ts";
import { createProfileSync } from "../app/learning/profile-sync.ts";
const ids = curriculum.missions.map(item => item.id);
const copy = value => structuredClone(value);

test("profile merge combines independent records without replacing first answers or pending drafts", () => {
  const base = emptyProgress(), local = copy(base), remote = copy(base);
  local.drafts[ids[0]] = { ...emptyDraft(), output: "La mia frase locale." };
  remote.drafts[ids[1]] = { ...emptyDraft(), output: "Una frase sul telefono." };
  remote.notes = "A note from the phone";
  const merged = mergeProfileProgress(base, local, remote, ids);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.progress.drafts[ids[0]], local.drafts[ids[0]]);
  assert.deepEqual(merged.progress.drafts[ids[1]], remote.drafts[ids[1]]);
  assert.equal(merged.progress.notes, remote.notes);
});

test("concurrent work on one task requires an explicit choice while unrelated work is retained", () => {
  const base = emptyProgress(), local = copy(base), remote = copy(base);
  base.drafts[ids[0]] = emptyDraft();
  local.drafts[ids[0]] = { ...emptyDraft(), output: "Draft on computer" };
  remote.drafts[ids[0]] = { ...emptyDraft(), output: "Draft on phone" };
  remote.notes = "Independent note";
  const pending = mergeProfileProgress(base, local, remote, ids);
  assert.deepEqual(pending.conflicts, [`drafts.${ids[0]}`]);
  assert.equal(pending.progress.drafts[ids[0]].output, "Draft on computer");
  assert.equal(pending.progress.notes, "Independent note");
  const chosen = mergeProfileProgress(base, local, remote, ids, "remote");
  assert.equal(chosen.progress.drafts[ids[0]].output, "Draft on phone");
  assert.equal(chosen.progress.notes, "Independent note");
  assert.equal(local.drafts[ids[0]].output, "Draft on computer");
});

test("profile merge respects intentional deletions and meaningful accents", () => {
  const base = { ...emptyProgress(), notes: "È una nota." };
  const local = { ...base, notes: "" }, remote = { ...base, translations: false };
  const merged = mergeProfileProgress(base, local, remote, ids);
  assert.equal(merged.progress.notes, ""); assert.equal(merged.progress.translations, false);
  assert.equal(sameProgress({ answer: "è" }, { answer: "e" }), false);
});

function serverFixture() {
  const profiles = new Map();
  const clients = [];
  let injectConflict = null;
  const client = (initial = emptyProgress()) => {
    let local = copy(initial), owner = "", session = "", online = true;
    const bases = new Map(), recoveries = [];
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const request = async (path, options = {}) => {
      if (!online) throw new Error("offline");
      const input = options.body ? JSON.parse(options.body) : {};
      const endpoint = path.split("/").at(-1);
      if (["register", "login"].includes(endpoint)) {
        const key = input.username.toLowerCase();
        if (endpoint === "register") profiles.set(key, { username: input.username, revision: 0, progress: null });
        if (!profiles.has(key)) return response({ error: "invalid-credentials" }, 401);
        session = key; return response({ username: profiles.get(key).username });
      }
      if (endpoint === "logout") { session = ""; return response({ ok: true }); }
      if (!session || !profiles.has(session)) return response({ error: "sign-in-required" }, 401);
      const record = profiles.get(session);
      if (options.method === "PUT") {
        if (input.username.toLowerCase() !== session) return response({ error: "profile_changed" }, 409);
        if (injectConflict) { const mutate = injectConflict; injectConflict = null; mutate(record); record.revision++; }
        if (input.revision !== record.revision) return response({ error: "conflict", revision: record.revision }, 409);
        record.progress = copy(input.progress); record.revision++;
        return response({ revision: record.revision });
      }
      return response(copy(record));
    };
    const sync = createProfileSync({
      ids, read: () => local, apply: p => { local = copy(p); }, link: () => owner, setLink: name => { owner = name; }, request,
      store: {
        base: async name => copy(bases.get(name.toLowerCase())),
        saveBase: async value => { bases.set(value.username.toLowerCase(), copy(value)); },
        recover: async value => { recoveries.push(copy(value)); }, recovery: async () => copy(recoveries.at(-1)),
        clear: async name => { bases.delete(name.toLowerCase()); },
      },
    });
    const result = { sync, read: () => copy(local), edit: change => { local = { ...change(copy(local)), updatedAt: new Date().toISOString() }; sync.changed(); },
      online: value => { online = value; }, expire: () => { session = ""; }, switchCookie: name => { session = name.toLowerCase(); }, bases, recoveries };
    clients.push(result); return result;
  };
  return { client, profiles, conflict: fn => { injectConflict = fn; }, close: () => clients.forEach(c => c.sync.stop()) };
}

test("a fresh profile uploads guest work and another device resumes it with only username and PIN", async () => {
  const server = serverFixture();
  try {
    const first = server.client({ ...emptyProgress(), notes: "My original practice" });
    await first.sync.connect("Samuel", "582947", true);
    assert.equal(first.sync.snapshot().status, "synced");
    const second = server.client(); await second.sync.connect("samuel", "582947", false);
    assert.equal(second.read().notes, "My original practice");
    assert.equal(second.sync.snapshot().status, "synced");
    assert.ok(!JSON.stringify([...first.bases.values()]).includes("582947"));
  } finally { server.close(); }
});

test("offline edits remain local and upload after reconnect without dropping another device's independent work", async () => {
  const server = serverFixture();
  try {
    const a = server.client(), b = server.client();
    await a.sync.connect("Samuel", "582947", true); await b.sync.connect("Samuel", "582947", false);
    b.online(false); b.edit(p => ({ ...p, notes: "Offline note" })); await b.sync.flush();
    assert.equal(b.sync.snapshot().status, "offline"); assert.equal(b.read().notes, "Offline note");
    a.edit(p => ({ ...p, drafts: { [ids[0]]: { ...emptyDraft(), output: "Una frase nuova." } } })); await a.sync.flush();
    b.online(true); await b.sync.flush();
    assert.equal(b.sync.snapshot().status, "synced");
    assert.equal(b.read().drafts[ids[0]].output, "Una frase nuova.");
    assert.equal(server.profiles.get("samuel").progress.notes, "Offline note");
  } finally { server.close(); }
});

test("same-task conflict stops automatic upload and retains both recoverable alternatives", async () => {
  const server = serverFixture();
  try {
    const a = server.client(), b = server.client();
    await a.sync.connect("Samuel", "582947", true); await b.sync.connect("Samuel", "582947", false);
    a.edit(p => ({ ...p, notes: "Computer version" })); await a.sync.flush();
    b.edit(p => ({ ...p, notes: "Phone version" })); await b.sync.flush();
    assert.equal(b.sync.snapshot().status, "conflict");
    assert.equal(server.profiles.get("samuel").progress.notes, "Computer version");
    const recovery = await b.sync.recovery();
    assert.equal(recovery.local.notes, "Phone version"); assert.equal(recovery.remote.notes, "Computer version");
    await b.sync.resolve("remote");
    assert.equal(b.read().notes, "Computer version"); assert.equal(b.sync.snapshot().status, "synced");
  } finally { server.close(); }
});

test("a stale server revision is fetched and reconciled instead of force-overwritten", async () => {
  const server = serverFixture();
  try {
    const a = server.client(); await a.sync.connect("Samuel", "582947", true);
    a.edit(p => ({ ...p, notes: "Local note" }));
    server.conflict(record => { record.progress.translations = false; });
    await a.sync.flush();
    assert.equal(server.profiles.get("samuel").progress.notes, "Local note");
    assert.equal(server.profiles.get("samuel").progress.translations, false);
    assert.equal(a.sync.snapshot().status, "synced");
  } finally { server.close(); }
});

test("expired and switched sessions never discard local work or write it to another profile", async () => {
  const server = serverFixture();
  try {
    const a = server.client(), b = server.client();
    await a.sync.connect("Samuel", "582947", true); await b.sync.connect("Anna", "784269", true);
    a.edit(p => ({ ...p, notes: "Unsent Samuel note" })); a.switchCookie("Anna"); await a.sync.flush();
    assert.equal(a.sync.snapshot().status, "expired");
    assert.equal(server.profiles.get("anna").progress.notes, "");
    await a.sync.logout(); assert.equal(a.read().notes, "Unsent Samuel note");
    await a.sync.connect("Samuel", "582947", false);
    assert.equal(server.profiles.get("samuel").progress.notes, "Unsent Samuel note");
    await a.sync.logout(); assert.equal(a.sync.snapshot().status, "guest");
    assert.equal(a.read().notes, ""); assert.equal(server.profiles.get("samuel").progress.notes, "Unsent Samuel note");
  } finally { server.close(); }
});
