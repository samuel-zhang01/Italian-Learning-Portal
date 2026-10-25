import { emptyProgress, parseProgress } from "./engine.ts";
import type { Progress } from "./types.ts";

export type BackupConflict = { area: string; key: string };
export type BackupMerge = { progress: Progress; additions: number; conflicts: number; details: BackupConflict[] };
const has = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
const clone = <T,>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const put = <T,>(target: Record<string, T>, key: string, value: T) => {
  Object.defineProperty(target, key, { value: clone(value), writable: true, enumerable: true, configurable: true });
};

export function backupCounts(progress: Progress) {
  return {
    lessons: Object.keys(progress.completed).length,
    lessonDrafts: Object.keys(progress.drafts).length,
    sessions: Object.keys(progress.sessions ?? {}).length,
    grammar: Object.keys(progress.academy?.grammar ?? {}).length,
    words: Object.keys(progress.academy?.words ?? {}).length,
    games: Object.keys(progress.arcade?.records ?? {}).length,
    diagnostics: Object.keys(progress.diagnostics?.runs ?? {}).length,
  };
}

export function backupMergeBase(current: Progress, raw: string | null, ids: string[], previouslySaved: boolean) {
  const progress = raw === null ? previouslySaved ? emptyProgress() : current : parseProgress(raw, ids);
  return { progress, changed: !same(progress, current), previouslySaved: raw !== null };
}

// Add missing evidence, preserving every overlapping local first attempt,
// response, active context and schedule. Conflicts remain in the source backup.
export function mergeProgressBackups(current: Progress, incoming: Progress, ids: string[], updatedAt = new Date().toISOString()): BackupMerge {
  const local = parseProgress(JSON.stringify(current), ids);
  const remote = parseProgress(JSON.stringify(incoming), ids);
  const out = clone(local);
  let additions = 0, conflicts = 0;
  const details: BackupConflict[] = [];
  const conflict = (area: string, key: string) => {
    conflicts += 1;
    if (details.length < 100) details.push({ area, key });
  };
  const missing = <T,>(target: Record<string, T>, source: Record<string, T>, area: string, max = Infinity) => {
    for (const [key, value] of Object.entries(source)) {
      if (has(target, key)) { if (!same(target[key], value)) conflict(area, key); continue; }
      if (Object.keys(target).length >= max) { conflict(`${area}-capacity`, key); continue; }
      put(target, key, value); additions += 1;
    }
  };
  for (const [id, value] of Object.entries(remote.completed)) {
    if (!has(out.completed, id) && has(local.drafts, id)) { conflict("lesson-draft", id); continue; }
    missing(out.completed, { [id]: value }, "lesson");
  }
  for (const [id, value] of Object.entries(remote.drafts)) {
    if (!has(local.drafts, id) && has(local.completed, id)) { conflict("completed-lesson", id); continue; }
    missing(out.drafts, { [id]: value }, "lesson-draft");
  }
  for (const [id, value] of Object.entries(remote.reviews)) {
    if (has(out.completed, id)) missing(out.reviews, { [id]: value }, "lesson-schedule");
  }
  const logged = new Map(out.reviewLog.map((row) => [`${row.date}:${row.id}`, row]));
  for (const row of remote.reviewLog) {
    const key = `${row.date}:${row.id}`, prior = logged.get(key);
    if (prior) { if (!same(prior, row)) conflict("lesson-review", key); continue; }
    if (out.reviewLog.length >= 2000) { conflict("lesson-review-capacity", key); continue; }
    out.reviewLog.push(clone(row)); logged.set(key, row); additions += 1;
  }
  if (remote.sessions) {
    out.sessions ??= {};
    missing(out.sessions, remote.sessions, "saved-session");
  }
  if (!out.notes && remote.notes) { out.notes = remote.notes; additions += 1; }
  else if (remote.notes && out.notes !== remote.notes) conflict("notebook", "notes");
  if (!local.academy && remote.academy) { out.academy = clone(remote.academy); additions += 1; }
  else if (out.academy && remote.academy) {
    const a = out.academy, b = remote.academy;
    for (const [id, draft] of Object.entries(b.grammar)) {
      const own = a.grammar[id];
      if (!has(a.grammar, id)) { put(a.grammar, id, draft); additions += 1; continue; }
      for (const [eid, attempts] of Object.entries(draft.attempts)) {
        if (!has(own.attempts, eid) && (has(own.answers, eid) || has(own.recallDrafts ?? {}, eid))) { conflict("grammar-pending-answer", `${id}:${eid}`); continue; }
        missing(own.attempts, { [eid]: attempts }, "grammar-first-attempt");
      }
      for (const [eid, answer] of Object.entries(draft.answers)) {
        if (has(local.academy!.grammar[id].recallDrafts ?? {}, eid) && !has(own.answers, eid)) continue;
        if (has(local.academy!.grammar[id].attempts, eid) && !has(own.answers, eid)) continue;
        missing(own.answers, { [eid]: answer }, "grammar-answer");
      }
      if (draft.recallDrafts) {
        own.recallDrafts ??= {};
        for (const [eid, pending] of Object.entries(draft.recallDrafts)) {
          if ((own.attempts[eid]?.at(-1)?.date ?? "") >= pending.date && !has(own.recallDrafts, eid)) continue;
          missing(own.recallDrafts, { [eid]: pending }, "grammar-recall-draft", 200);
        }
      }
      if (draft.hintDates) { own.hintDates ??= {}; missing(own.hintDates, draft.hintDates, "grammar-hint-date"); }
      for (const eid of draft.hints) if (!own.hints.includes(eid)) {
        if (own.hints.length < 200) { own.hints.push(eid); additions += 1; } else conflict("grammar-hint-capacity", eid);
      }
      if (!same({ output: own.output, rubric: own.rubric, completed: own.completed }, { output: draft.output, rubric: draft.rubric, completed: draft.completed })) conflict("grammar-production", id);
    }
    missing(a.companion, b.companion, "companion-response");
    missing(a.words, b.words, "word-schedule");
    for (const [key, run] of Object.entries(b.assessments)) {
      const own = a.assessments[key];
      if (!has(a.assessments, key)) { put(a.assessments, key, run); additions += 1; continue; }
      if (!same(own.exerciseIds, run.exerciseIds)) { conflict("diagnostic-item-set", key); continue; }
      missing(own.answers, run.answers, "diagnostic-first-answer");
      own.completed = Object.keys(own.answers).length === own.exerciseIds.length;
    }
    if (!a.programme && b.programme) { a.programme = clone(b.programme); additions += 1; }
    else if (a.programme && b.programme) {
      if (a.programme.id !== b.programme.id || a.programme.started !== b.programme.started) conflict("active-programme", b.programme.id);
      else {
        for (const [index, date] of Object.entries(b.programme.completed)) {
          if (Number(index) >= a.programme.day && !has(a.programme.completed, index)) { conflict("active-programme-day", index); continue; }
          missing(a.programme.completed, { [index]: date }, "programme-day");
        }
        if (b.programme.practice) {
          a.programme.practice ??= {};
          for (const [index, response] of Object.entries(b.programme.practice)) {
            if (Number(index) > a.programme.day && !has(a.programme.practice, index)) { conflict("future-programme-response", index); continue; }
            missing(a.programme.practice, { [index]: response }, "programme-response", 366);
          }
        }
      }
    }
  }
  if (!local.arcade && remote.arcade) { out.arcade = clone(remote.arcade); additions += 1; }
  else if (out.arcade && remote.arcade) {
    missing(out.arcade.records, remote.arcade.records, "game-first-attempt-and-schedule", 1000);
    if (!out.arcade.active && remote.arcade.active && !out.arcade.history.some((run) => run.id === remote.arcade!.active!.id)) { out.arcade.active = clone(remote.arcade.active); additions += 1; }
    else if (remote.arcade.active && !same(out.arcade.active, remote.arcade.active)) conflict("paused-game", remote.arcade.active.id);
    const history = new Set(out.arcade.history.map((run) => run.id));
    for (const run of remote.arcade.history) {
      if (out.arcade.active?.id === run.id) { conflict("active-game-history", run.id); continue; }
      if (history.has(run.id)) continue;
      if (out.arcade.history.length >= 30) { conflict("game-history-capacity", run.id); continue; }
      out.arcade.history.push(clone(run)); history.add(run.id); additions += 1;
    }
  }
  if (!local.diagnostics && remote.diagnostics) { out.diagnostics = clone(remote.diagnostics); additions += 1; }
  else if (out.diagnostics && remote.diagnostics) {
    for (const [key, run] of Object.entries(remote.diagnostics.runs)) {
      const own = out.diagnostics.runs[key];
      if (!has(out.diagnostics.runs, key)) { missing(out.diagnostics.runs, { [key]: run }, "chapter-check", 400); continue; }
      if (!same(own.itemIds, run.itemIds)) { conflict("chapter-check-item-set", key); continue; }
      for (const id of own.itemIds) {
        const answer = run.answers[id];
        if (has(own.answers, id)) { if (answer && !same(own.answers[id], answer)) conflict("chapter-first-answer", id); continue; }
        if (has(own.drafts, id)) { if (answer) conflict("chapter-pending-answer", id); break; }
        if (!answer) break;
        missing(own.answers, { [id]: answer }, "chapter-first-answer");
      }
      const currentId = own.itemIds.find((id) => !has(own.answers, id));
      for (const [id, draft] of Object.entries(run.drafts)) if (id === currentId) missing(own.drafts, { [id]: draft }, "chapter-answer-draft");
      for (const id of run.hints) if (!own.hints.includes(id)) { own.hints.push(id); additions += 1; }
    }
  }
  out.updatedAt = updatedAt;
  return { progress: parseProgress(JSON.stringify(out), ids), additions, conflicts, details };
}
