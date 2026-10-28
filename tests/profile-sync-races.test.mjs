import test from "node:test";
import assert from "node:assert/strict";
import curriculum from "../app/learning/curriculum.json" with { type: "json" };
import { emptyProgress } from "../app/learning/engine.ts";
import { createProfileSync } from "../app/learning/profile-sync.ts";

const ids = curriculum.missions.map((mission) => mission.id);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  let local = { ...emptyProgress(), notes: "Before connecting" };
  let cloud = null, revision = 0, link = "";
  const bases = new Map();
  const gates = new Map();
  const requests = [];
  const linkWrites = [];
  let recovery;
  const waitAt = async (key) => {
    const gate = gates.get(key);
    if (gate) { gate.arrived.resolve(); await gate.release.promise; gates.delete(key); }
  };
  const sync = createProfileSync({
    ids,
    read: () => local,
    apply: (progress) => { local = progress; },
    link: () => link,
    setLink: (value) => { link = value; linkWrites.push(value); },
    store: {
      base: async (username) => bases.get(username),
      saveBase: async (base) => { await waitAt("IDB saveBase"); bases.set(base.username, structuredClone(base)); },
      clear: async (username) => { bases.delete(username); },
      recover: async (value) => { recovery = value; },
      recovery: async () => recovery,
    },
    request: async (url, init = {}) => {
      const key = `${init.method ?? "GET"} ${String(url).split("/").at(-1)}`;
      requests.push(key);
      await waitAt(key);
      let data;
      if (key === "POST register" || key === "POST login") data = { username: "TestLearner" };
      else if (key === "GET progress") data = { username: "TestLearner", revision, progress: structuredClone(cloud) };
      else if (key === "PUT progress") {
        const payload = JSON.parse(init.body);
        assert.equal(payload.revision, revision);
        cloud = payload.progress; revision += 1; data = { revision };
      } else if (key === "POST logout") data = { ok: true };
      else throw new Error(`Unexpected request ${key}`);
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    },
  });
  return {
    sync, requests, linkWrites,
    local: () => local,
    cloud: () => cloud,
    edit: (notes) => { local = { ...local, notes }; sync.changed(); },
    delay: (key) => {
      const gate = { arrived: deferred(), release: deferred() };
      gates.set(key, gate);
      return { arrived: gate.arrived.promise, release: gate.release.resolve };
    },
  };
}

test("joining a profile preserves work typed while the first save is in flight", async () => {
  const f = fixture();
  try {
    const gate = f.delay("PUT progress");
    const joining = f.sync.connect("TestLearner", "582941", true);
    await gate.arrived;
    f.edit("Typed while first profile save was waiting");
    gate.release();
    await joining;
    assert.equal(f.local().notes, "Typed while first profile save was waiting");
    assert.equal(f.cloud().notes, "Before connecting");
    assert.equal(f.sync.snapshot().status, "saving");
    await f.sync.flush();
    assert.equal(f.cloud().notes, f.local().notes);
    assert.equal(f.sync.snapshot().status, "synced");
  } finally { f.sync.stop(); }
});

test("work arriving during sign-out remains local and requires sign-in before another sync", async () => {
  const f = fixture();
  try {
    await f.sync.connect("TestLearner", "582941", true);
    const gate = f.delay("POST logout");
    const leaving = f.sync.logout();
    await gate.arrived;
    f.edit("Typed while sign-out was waiting");
    gate.release();
    await leaving;
    assert.equal(f.local().notes, "Typed while sign-out was waiting");
    assert.equal(f.sync.snapshot().status, "expired");
    assert.equal(f.sync.snapshot().error, "new-work-kept");
    const before = f.requests.length;
    await f.sync.flush();
    assert.equal(f.requests.length, before);
  } finally { f.sync.stop(); }
});

test("editing a synced profile immediately shows saving until the pending server write finishes", async () => {
  const f = fixture();
  try {
    await f.sync.connect("TestLearner", "582941", true);
    assert.equal(f.sync.snapshot().status, "synced");
    const gate = f.delay("PUT progress");
    f.edit("Not yet sent");
    assert.equal(f.sync.snapshot().status, "saving");
    const saving = f.sync.flush();
    await gate.arrived;
    assert.equal(f.sync.snapshot().status, "saving");
    assert.equal(f.cloud().notes, "Before connecting");
    gate.release();
    await saving;
    assert.equal(f.cloud().notes, "Not yet sent");
    assert.equal(f.sync.snapshot().status, "synced");
  } finally { f.sync.stop(); }
});

test("editing while IndexedDB saves the merge base remains pending and is sent in the next sync", async () => {
  const f = fixture();
  try {
    await f.sync.connect("TestLearner", "582941", true);
    const gate = f.delay("IDB saveBase");
    f.edit("First edit");
    const saving = f.sync.flush();
    await gate.arrived;
    f.edit("Second edit while IndexedDB is waiting");
    gate.release();
    await saving;
    assert.equal(f.local().notes, "Second edit while IndexedDB is waiting");
    assert.equal(f.cloud().notes, "First edit");
    assert.equal(f.sync.snapshot().status, "saving");
    await f.sync.flush();
    assert.equal(f.cloud().notes, f.local().notes);
    assert.equal(f.sync.snapshot().status, "synced");
  } finally { f.sync.stop(); }
});

test("stopping during an IndexedDB write prevents the cancelled generation from republishing a profile link", async () => {
  const f = fixture();
  try {
    await f.sync.connect("TestLearner", "582941", true);
    const gate = f.delay("IDB saveBase");
    f.edit("Safe local edit");
    const saving = f.sync.flush();
    await gate.arrived;
    const linksBeforeStop = f.linkWrites.length;
    f.sync.stop();
    gate.release();
    await saving;
    assert.equal(f.linkWrites.length, linksBeforeStop);
    assert.equal(f.local().notes, "Safe local edit");
    assert.notEqual(f.sync.snapshot().status, "synced");
    assert.equal(f.sync.snapshot().error, "");
  } finally { f.sync.stop(); }
});
