import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { submissions } from "../../../db/schema";

type RequestBody = { lessonId?: string; exerciseId?: string; skill?: string; prompt?: string; response?: string; target?: string; hint?: string };
type Feedback = { score: number; summary: string; corrections: string[]; betterItalian: string; nextStep: string; evaluator: "ai" | "rubric" };

const words = (value: string) => value.toLocaleLowerCase("it").normalize("NFKD").replace(/[^a-z0-9à-ü' ]/gi, " ").split(/\s+/).filter(Boolean);

function rubric(body: Required<RequestBody>): Feedback {
  const responseWords = words(body.response);
  const targetWords = new Set(words(`${body.target} ${body.hint}`));
  const matches = responseWords.filter(word => targetWords.has(word)).length;
  const lengthScore = Math.min(45, responseWords.length * 3);
  const overlapScore = Math.min(45, matches * 9);
  const score = Math.max(10, Math.min(95, lengthScore + overlapScore + (/[.!?]$/.test(body.response.trim()) ? 10 : 5)));
  return {
    score,
    summary: score >= 70 ? "Buon tentativo: il messaggio è chiaro e contiene lessico pertinente." : "Hai iniziato bene; ora rendi la risposta più completa e specifica.",
    corrections: responseWords.length < 6 ? ["Aggiungi almeno due frasi complete."] : ["Controlla articoli, accordi e forma del verbo prima di inviare."],
    betterItalian: body.target || "Prova a collegare le idee con e, ma, poi e perché.",
    nextStep: "Riscrivi una volta senza guardare, poi leggila ad alta voce.",
    evaluator: "rubric",
  };
}

function parseResponse(data: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }): Omit<Feedback, "evaluator"> | null {
  const text = data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const raw = await request.json() as RequestBody;
    if (!raw.lessonId || !raw.exerciseId || !raw.skill || !raw.prompt || !raw.response) return Response.json({ error: "Missing submission fields" }, { status: 400 });
    const body = { lessonId: raw.lessonId, exerciseId: raw.exerciseId, skill: raw.skill, prompt: raw.prompt, response: raw.response.slice(0, 3000), target: raw.target || "", hint: raw.hint || "" };
    const localEnv = env as unknown as { OPENAI_API_KEY?: string; PARLIAMO_ENABLE_PAID_AI?: string };
    const apiKey = localEnv.OPENAI_API_KEY;
    const paidAiEnabled = localEnv.PARLIAMO_ENABLE_PAID_AI === "true";
    let feedback: Feedback = rubric(body);

    // Remote, metered feedback is deliberately double opt-in. The normal local
    // launcher sets this flag to false and removes any inherited API key.
    if (paidAiEnabled && apiKey) {
      const result = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          reasoning: { effort: "low" },
          instructions: "You are a warm, precise CEFR A1 Italian tutor. Assess communicative success first, then give concise bilingual-friendly correction. Never penalize harmless punctuation. Return only the requested JSON.",
          input: `Task: ${body.prompt}\nLearner response: ${body.response}\nReference language: ${body.target}\nTask hint: ${body.hint}`,
          text: { format: { type: "json_schema", name: "a1_feedback", strict: true, schema: { type: "object", additionalProperties: false, properties: { score: { type: "integer", minimum: 0, maximum: 100 }, summary: { type: "string" }, corrections: { type: "array", items: { type: "string" }, maxItems: 3 }, betterItalian: { type: "string" }, nextStep: { type: "string" } }, required: ["score", "summary", "corrections", "betterItalian", "nextStep"] } } },
        }),
      });
      if (result.ok) {
        const parsed = parseResponse(await result.json());
        if (parsed) feedback = { ...parsed, evaluator: "ai" };
      }
    }

    await getDb().insert(submissions).values({ learnerId: "samuel", lessonId: body.lessonId, exerciseId: body.exerciseId, skill: body.skill, response: body.response, feedback: JSON.stringify(feedback), score: feedback.score, evaluator: feedback.evaluator });
    return Response.json({ feedback });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to evaluate response" }, { status: 500 });
  }
}
