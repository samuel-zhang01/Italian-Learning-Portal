import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const learnerState = sqliteTable("learner_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const practiceEvents = sqliteTable("practice_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  learnerId: text("learner_id").notNull().default("samuel"),
  lessonId: text("lesson_id").notNull(),
  skill: text("skill").notNull(),
  exerciseId: text("exercise_id").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  xp: integer("xp").notNull().default(0),
  responseMs: integer("response_ms").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  lessonId: text("lesson_id"),
  position: integer("position").notNull().default(0),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const submissions = sqliteTable("submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  learnerId: text("learner_id").notNull().default("samuel"),
  lessonId: text("lesson_id").notNull(),
  exerciseId: text("exercise_id").notNull(),
  skill: text("skill").notNull(),
  response: text("response").notNull(),
  feedback: text("feedback").notNull(),
  score: integer("score").notNull(),
  evaluator: text("evaluator").notNull().default("rubric"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
