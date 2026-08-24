import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { learnerState, practiceEvents } from "../../../db/schema";

const LEARNER_ID = "samuel";

export async function GET() {
  try {
    await ensureDatabase();
    const db = getDb();
    const [state] = await db.select().from(learnerState).where(eq(learnerState.id, LEARNER_ID)).limit(1);
    const events = await db.select().from(practiceEvents).where(eq(practiceEvents.learnerId, LEARNER_ID)).orderBy(desc(practiceEvents.id)).limit(500);
    const parsed = state ? JSON.parse(state.payload) as Record<string, unknown> : null;
    return Response.json({ state: parsed ? { ...parsed, revision: state!.revision } : null, revision: state?.revision ?? 0, events });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Progress database unavailable" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDatabase();
    const body = await request.json() as { state?: unknown; revision?: number };
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return Response.json({ error: "state is required" }, { status: 400 });
    const expectedRevision = Math.max(0, Math.trunc(Number(body.revision || 0)));
    const revision = expectedRevision + 1;
    const state = { ...(body.state as Record<string, unknown>), revision };
    const updatedAt = new Date().toISOString();
    const saved = await env.DB.prepare(`
      INSERT INTO learner_state (id, payload, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        revision = excluded.revision,
        updated_at = excluded.updated_at
      WHERE learner_state.revision = ?
      RETURNING revision
    `).bind(LEARNER_ID, JSON.stringify(state), revision, updatedAt, expectedRevision).first<{ revision: number }>();
    if (!saved) {
      const current = await env.DB.prepare("SELECT payload, revision FROM learner_state WHERE id = ?").bind(LEARNER_ID).first<{ payload: string; revision: number }>();
      const currentState = current ? { ...(JSON.parse(current.payload) as Record<string, unknown>), revision: current.revision } : null;
      return Response.json({ error: "revision_conflict", state: currentState, revision: current?.revision ?? 0 }, { status: 409 });
    }
    return Response.json({ ok: true, state, revision: saved.revision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save progress" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const body = await request.json() as { lessonId?: string; skill?: string; exerciseId?: string; correct?: boolean; xp?: number; responseMs?: number };
    if (!body.lessonId || !body.skill || !body.exerciseId) return Response.json({ error: "lessonId, skill and exerciseId are required" }, { status: 400 });
    const db = getDb();
    const [event] = await db.insert(practiceEvents).values({ learnerId: LEARNER_ID, lessonId: body.lessonId, skill: body.skill, exerciseId: body.exerciseId, correct: Boolean(body.correct), xp: Number(body.xp || 0), responseMs: Math.max(0, Number(body.responseMs || 0)) }).returning();
    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to record practice" }, { status: 500 });
  }
}
