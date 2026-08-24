import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { contentItems } from "../../../db/schema";

export async function GET() {
  try {
    await ensureDatabase();
    const rows = await getDb().select().from(contentItems).orderBy(asc(contentItems.kind), asc(contentItems.position));
    const content: Record<string, unknown[]> = {};
    for (const row of rows) {
      (content[row.kind] ||= []).push(JSON.parse(row.payload));
    }
    return Response.json({ content, count: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Content database unavailable" }, { status: 500 });
  }
}
