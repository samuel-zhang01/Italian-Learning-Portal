import { parseProgress } from "./engine.ts";
import type { Progress } from "./types.ts";

const missing = Symbol("missing");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function sameProgress(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameProgress(value, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameProgress(a[key], b[key]));
}
const atomic = (path: string[]) => {
  if (path.length === 1 && ["plan", "reviewLog"].includes(path[0])) return true;
  if (path.length === 2 && ["completed", "drafts", "reviews", "sessions"].includes(path[0])) return true;
  if (path[0] === "academy") return path[1] === "programme" || path.length === 3;
  if (["arcade", "vocabPractice"].includes(path[0])) return (path.length === 2 && path[1] !== "records") || path.length === 3;
  return ["diagnostics", "oralPractice"].includes(path[0]) && path.length === 3;
};

// Merge independent records. Concurrent changes to one answer/session remain
// explicit, rather than upgrading a first attempt or dropping a pending draft.
export function mergeProfileProgress(base: Progress, local: Progress, remote: Progress, ids: string[], preference?: "local" | "remote") {
  const conflicts: string[] = [];
  const walk = (before: unknown, ours: unknown, theirs: unknown, path: string[]): unknown => {
    if (sameProgress(ours, theirs)) return ours;
    if (sameProgress(ours, before)) return theirs;
    if (sameProgress(theirs, before)) return ours;
    if (path[0] === "updatedAt") return ours;
    if (!atomic(path) && object(ours) && object(theirs) && (object(before) || before === missing)) {
      const result: Record<string, unknown> = Object.create(null);
      const old = object(before) ? before : {};
      for (const key of new Set([...Object.keys(old), ...Object.keys(ours), ...Object.keys(theirs)])) {
        const value = walk(Object.hasOwn(old, key) ? old[key] : missing, Object.hasOwn(ours, key) ? ours[key] : missing, Object.hasOwn(theirs, key) ? theirs[key] : missing, [...path, key]);
        if (value !== missing) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    conflicts.push(path.join("."));
    return preference === "remote" ? theirs : ours;
  };
  const candidate = walk(base, local, remote, []) as Progress;
  try {
    return { progress: parseProgress(JSON.stringify(candidate), ids), conflicts };
  } catch {
    // A cross-record invariant can make a fieldwise merge invalid. Keep both
    // complete snapshots available and require an explicit choice.
    return { progress: parseProgress(JSON.stringify(preference === "remote" ? remote : local), ids), conflicts: ["progress", ...conflicts] };
  }
}

export function hasStudyRecords(p: Progress) {
  return Boolean(p.notes || Object.keys(p.completed).length || Object.keys(p.drafts).length || Object.keys(p.sessions ?? {}).length
    || p.academy?.programme || Object.keys(p.academy?.grammar ?? {}).length || Object.keys(p.academy?.companion ?? {}).length
    || Object.keys(p.academy?.words ?? {}).length || Object.keys(p.academy?.assessments ?? {}).length
    || p.arcade?.active || Object.keys(p.arcade?.records ?? {}).length || Object.keys(p.diagnostics?.runs ?? {}).length
    || Object.keys(p.oralPractice?.runs ?? {}).length || p.vocabPractice?.active || Object.keys(p.vocabPractice?.records ?? {}).length);
}
