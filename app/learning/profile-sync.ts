import { emptyProgress, parseProgress } from "./engine.ts";
import { mergeProfileProgress, sameProgress, hasStudyRecords } from "./profile-merge.ts";
import { mergeProgressBackups } from "./backup-merge.ts";
import type { ProfileBase, ProfileStore } from "./profile-store.ts";
import type { Progress } from "./types.ts";

export const PROFILE_LINK_KEY = "parliamo-profile-link-v1";
export type ProfileStatus = "guest" | "checking" | "joining" | "synced" | "saving" | "offline" | "conflict" | "expired" | "error";
export type ProfileState = { status: ProfileStatus; username: string; error: string; conflicts: string[]; lastSynced: string; hasLocal: boolean; foreignLocal: boolean };
type Remote = { username: string; revision: number; progress: Progress | null };
type Dependencies = {
  ids: string[]; store: ProfileStore; read: () => Progress; apply: (p: Progress) => void;
  link: () => string; setLink: (username: string) => void; request?: typeof fetch;
};
class ApiError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
const identity = (name: string) => name.toLowerCase();

export function createProfileSync(deps: Dependencies) {
  let state: ProfileState = { status: "guest", username: "", error: "", conflicts: [], lastSynced: "", hasLocal: false, foreignLocal: false };
  const listeners = new Set<() => void>();
  let base: ProfileBase | undefined;
  let candidate: Remote | undefined;
  let flight: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let generation = 0;
  let dirty = false;
  const publish = (changes: Partial<ProfileState>) => { state = { ...state, ...changes }; listeners.forEach(listener => listener()); };
  const valid = (p: Progress) => parseProgress(JSON.stringify(p), deps.ids);
  const api = async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await (deps.request ?? fetch)(`/api/profile/${path}`, {
        method, credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new ApiError(0, "offline"); }
    let data: Record<string, unknown>;
    try { data = await response.json(); } catch { throw new ApiError(response.status, "service-unavailable"); }
    if (!response.ok) throw new ApiError(response.status, typeof data.error === "string" ? data.error : "service-unavailable");
    return data as T;
  };
  const remote = async (username: string) => {
    const result = await api<Remote>("progress");
    if (identity(result.username) !== identity(username)) throw new ApiError(409, "profile_changed");
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error("invalid-profile");
    if (result.progress !== null) result.progress = valid(result.progress);
    return result;
  };
  const errorState = (error: unknown) => {
    const code = error instanceof Error ? error.message : "service-unavailable";
    const expired = error instanceof ApiError && (error.status === 401 || code === "profile_changed");
    publish({ status: expired ? "expired" : code === "offline" ? "offline" : "error", error: code });
  };
  const remember = async (username: string, revision: number, progress: Progress) => {
    const ownGeneration = generation;
    const value = { username, revision, progress: valid(progress) };
    await deps.store.saveBase(value);
    if (stopped || ownGeneration !== generation) throw new Error("operation-cancelled");
    deps.setLink(username);
    base = value;
  };
  const apply = (progress: Progress) => { if (!sameProgress(deps.read(), progress)) deps.apply(valid(progress)); };

  async function sync(preference?: "local" | "remote") {
    if (stopped || !base || state.status === "joining" || (state.status === "conflict" && !preference) || state.status === "expired") return;
    const ownGeneration = generation;
    const username = base.username;
    const start = valid(deps.read());
    const before = valid(base.progress);
    publish({ status: "saving", error: "" });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await remote(username);
        if (stopped || ownGeneration !== generation) return;
        const cloud = saved.progress ?? emptyProgress();
        const merged = mergeProfileProgress(before, start, cloud, deps.ids, preference);
        if (merged.conflicts.length && !preference) {
          await deps.store.recover({ date: new Date().toISOString(), username, local: start, remote: cloud });
          publish({ status: "conflict", conflicts: merged.conflicts }); return;
        }
        if (preference) await deps.store.recover({ date: new Date().toISOString(), username, local: start, remote: cloud });
        let revision = saved.revision;
        if (!sameProgress(merged.progress, cloud)) {
          try {
            const result = await api<{ revision: number }>("progress", "PUT", { username, revision, progress: merged.progress });
            revision = result.revision;
          } catch (error) {
            if (error instanceof ApiError && error.status === 409 && error.message === "conflict") continue;
            throw error;
          }
        }
        if (stopped || ownGeneration !== generation) return;
        // Typing while a request is in flight remains local and is sent next.
        const latest = valid(deps.read());
        const rebased = mergeProfileProgress(start, latest, merged.progress, deps.ids);
        apply(rebased.progress);
        await remember(username, revision, merged.progress);
        if (rebased.conflicts.length) {
          await deps.store.recover({ date: new Date().toISOString(), username, local: latest, remote: merged.progress });
          publish({ status: "conflict", conflicts: rebased.conflicts }); return;
        }
        const pending = !sameProgress(deps.read(), merged.progress);
        publish({ status: pending ? "saving" : "synced", error: "", conflicts: [], lastSynced: new Date().toISOString() });
        if (pending) changed();
        return;
      }
      throw new Error("busy-profile");
    } catch (error) { if (!stopped && ownGeneration === generation) errorState(error); }
  }
  const flush = (preference?: "local" | "remote") => {
    if (flight) return flight;
    dirty = false;
    flight = sync(preference).finally(() => { flight = undefined; if (dirty) changed(); });
    return flight;
  };
  function changed() {
    if (stopped || !base || ["guest", "joining", "expired", "conflict"].includes(state.status)) return;
    dirty = true;
    if (state.status !== "offline") publish({ status: "saving" });
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 900);
  }
  async function start() {
    stopped = false;
    const ownGeneration = generation;
    const username = deps.link();
    if (!username) return;
    publish({ username, status: "checking" });
    try {
      const stored = await deps.store.base(username);
      if (stopped || ownGeneration !== generation) return;
      if (!stored) { publish({ status: "expired", error: "sign-in-again" }); return; }
      base = { ...stored, progress: valid(stored.progress) };
      await flush();
    } catch (error) { if (!stopped && ownGeneration === generation) errorState(error); }
  }
  async function connect(username: string, pin: string, create: boolean) {
    if (flight) await flight;
    generation += 1; clearTimeout(timer); base = undefined;
    const ownGeneration = generation;
    const previousOwner = deps.link();
    publish({ status: "checking", error: "", conflicts: [] });
    try {
      const result = await api<{ username: string }>(create ? "register" : "login", "POST", { username, pin });
      if (stopped || ownGeneration !== generation) return;
      candidate = await remote(result.username);
      if (stopped || ownGeneration !== generation) return;
      const own = identity(previousOwner) === identity(result.username) ? await deps.store.base(result.username) : undefined;
      if (stopped || ownGeneration !== generation) return;
      publish({ username: result.username });
      if (own) {
        base = { ...own, progress: valid(own.progress) }; candidate = undefined;
        await flush(); return;
      }
      const hasLocal = hasStudyRecords(deps.read());
      const foreignLocal = Boolean(previousOwner && identity(previousOwner) !== identity(result.username));
      publish({ status: "joining", hasLocal, foreignLocal });
      if (!hasLocal || (create && !foreignLocal)) await finishJoin(true);
    } catch (error) { if (!stopped && ownGeneration === generation) errorState(error); }
  }
  async function finishJoin(includeLocal: boolean) {
    if (!candidate) return;
    const target = candidate.username;
    const ownGeneration = generation;
    publish({ status: "saving", error: "" });
    try {
      const saved = await remote(target);
      if (stopped || ownGeneration !== generation) return;
      const local = valid(deps.read());
      if (hasStudyRecords(local)) await deps.store.recover({ date: new Date().toISOString(), username: deps.link() || target, local, remote: saved.progress ?? undefined });
      const merged = includeLocal && !state.foreignLocal
        ? saved.progress ? mergeProgressBackups(saved.progress, local, deps.ids).progress : local
        : saved.progress ?? emptyProgress();
      let revision = saved.revision;
      if (!sameProgress(merged, saved.progress)) revision = (await api<{ revision: number }>("progress", "PUT", { username: target, revision, progress: merged })).revision;
      if (stopped || ownGeneration !== generation) return;
      const latest = valid(deps.read());
      if ((!includeLocal || state.foreignLocal) && !sameProgress(local, latest)) {
        await deps.store.recover({ date: new Date().toISOString(), username: deps.link() || target, local: latest, remote: merged });
        publish({ status: "joining", error: "work-changed" }); return;
      }
      const rebased = mergeProfileProgress(local, latest, merged, deps.ids);
      deps.setLink(target);
      apply(rebased.progress);
      await remember(target, revision, merged);
      candidate = undefined;
      const pending = !sameProgress(deps.read(), merged);
      publish({ status: rebased.conflicts.length ? "conflict" : pending ? "saving" : "synced", username: target, error: "", conflicts: rebased.conflicts, lastSynced: new Date().toISOString(), hasLocal: false, foreignLocal: false });
      if (pending && !rebased.conflicts.length) changed();
    } catch (error) { if (!stopped && ownGeneration === generation) errorState(error); }
  }
  async function logout() {
    clearTimeout(timer);
    if (state.status === "expired") { publish({ error: "sign-in-before-sign-out" }); return; }
    if (base) {
      await flush();
      if (state.status !== "synced" || !sameProgress(deps.read(), base.progress)) return;
    }
    try {
      const leaving = valid(deps.read());
      await api("logout", "POST", {});
      generation += 1;
      if (!sameProgress(leaving, deps.read())) {
        publish({ status: "expired", error: "new-work-kept" }); return;
      }
      const username = base?.username;
      deps.setLink("");
      apply(emptyProgress());
      base = undefined; candidate = undefined;
      publish({ status: "guest", username: "", error: "", conflicts: [], lastSynced: "" });
      if (username) await deps.store.clear(username);
    } catch (error) { errorState(error); }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start, changed, flush, connect, finishJoin, logout,
    resolve: (preference: "local" | "remote") => flush(preference),
    recovery: () => deps.store.recovery(),
    stop: () => { stopped = true; generation += 1; clearTimeout(timer); },
  };
}
export type ProfileSync = ReturnType<typeof createProfileSync>;
