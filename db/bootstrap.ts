import { env } from "cloudflare:workers";
import seed from "./content-seed.json";

let ready: Promise<void> | null = null;

export function ensureDatabase() {
  if (ready) return ready;
  ready = (async () => {
    const d1 = env.DB;
    if (!d1) throw new Error("Cloudflare D1 binding DB is unavailable");
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS content_items (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, lesson_id TEXT, position INTEGER DEFAULT 0 NOT NULL, payload TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS learner_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS practice_events (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, learner_id TEXT DEFAULT 'samuel' NOT NULL, lesson_id TEXT NOT NULL, skill TEXT NOT NULL, exercise_id TEXT NOT NULL, correct INTEGER NOT NULL, xp INTEGER DEFAULT 0 NOT NULL, response_ms INTEGER DEFAULT 0 NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, learner_id TEXT DEFAULT 'samuel' NOT NULL, lesson_id TEXT NOT NULL, exercise_id TEXT NOT NULL, skill TEXT NOT NULL, response TEXT NOT NULL, feedback TEXT NOT NULL, score INTEGER NOT NULL, evaluator TEXT DEFAULT 'rubric' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS content_kind_position_idx ON content_items(kind, position)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS practice_learner_created_idx ON practice_events(learner_id, created_at)"),
    ]);
    const count = await d1.prepare("SELECT COUNT(*) AS total FROM content_items").first<{ total: number }>();
    const curriculumMarker = await d1.prepare("SELECT payload FROM content_items WHERE id = 'reading:r20'").first<{ payload: string }>();
    const needsRefresh = Number(count?.total || 0) < seed.length || !curriculumMarker?.payload.includes('"Programma del fine settimana"');
    if (needsRefresh) {
      for (let i = 0; i < seed.length; i += 50) {
        await d1.batch(seed.slice(i, i + 50).map(row => d1.prepare("INSERT OR REPLACE INTO content_items (id, kind, lesson_id, position, payload) VALUES (?, ?, ?, ?, ?)").bind(row.id, row.kind, row.lessonId, row.position, JSON.stringify(row.payload))));
      }
    }
  })().catch(error => { ready = null; throw error; });
  return ready;
}
