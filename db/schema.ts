import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  originalText: text("original_text").notNull(),
  title: text("title").notNull(),
  answer: text("answer").notNull(),
  summary: text("summary").notNull(),
  status: text("status", { enum: ["draft", "confirmed", "needs_review"] }).notNull().default("confirmed"),
  mastery: text("mastery", { enum: ["unreviewed", "learning", "mastered"] }).notNull().default("unreviewed"),
  familiarity: integer("familiarity").notNull().default(0),
  model: text("model"),
  promptVersion: text("prompt_version"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_questions_created_at").on(table.createdAt),
  index("idx_questions_status_updated_at").on(table.status, table.updatedAt),
  index("idx_questions_mastery_updated_at").on(table.mastery, table.updatedAt),
]);

export const questionOptions = sqliteTable("question_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  content: text("content"),
  explanation: text("explanation").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("uq_question_options_question_label").on(table.questionId, table.label),
  index("idx_question_options_question_id").on(table.questionId),
]);

export const knowledgePoints = sqliteTable("knowledge_points", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  description: text("description").notNull(),
  examCue: text("exam_cue").notNull(),
  status: text("status", { enum: ["candidate", "confirmed", "merged"] }).notNull().default("candidate"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("uq_knowledge_points_normalized_name").on(table.normalizedName),
  index("idx_knowledge_points_status_name").on(table.status, table.name),
]);

export const questionKnowledgePoints = sqliteTable("question_knowledge_points", {
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  knowledgePointId: text("knowledge_point_id").notNull().references(() => knowledgePoints.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.knowledgePointId] }),
  index("idx_question_knowledge_points_knowledge_id").on(table.knowledgePointId),
]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  kind: text("kind", { enum: ["service", "topic", "keyword"] }).notNull(),
  status: text("status", { enum: ["candidate", "confirmed", "merged"] }).notNull().default("candidate"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("uq_tags_kind_normalized_name").on(table.kind, table.normalizedName),
  index("idx_tags_kind_name").on(table.kind, table.name),
]);

export const questionTags = sqliteTable("question_tags", {
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.tagId] }),
  index("idx_question_tags_tag_id").on(table.tagId),
]);

export const aiAnalysisRuns = sqliteTable("ai_analysis_runs", {
  id: text("id").primaryKey(),
  questionId: text("question_id").references(() => questions.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  rawResponse: text("raw_response").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(1),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_ai_analysis_runs_question_created").on(table.questionId, table.createdAt),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
