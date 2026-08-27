import { ensureDatabase, getD1 } from "./init";
import type { SavedQuestion } from "../lib/domain";
import { getSearchConcepts } from "../lib/search";
import { familiarityWeight } from "../lib/study";

type QuestionRow = {
  id: string;
  sequence?: number;
  original_text: string;
  title: string;
  answer: string;
  summary: string;
  mastery: "unreviewed" | "learning" | "mastered";
  familiarity: number;
  created_at: string;
};

type OptionRow = { label: string; content: string | null; explanation: string; is_correct: number };
type TagRow = { name: string; kind: "service" | "topic" | "keyword" };
type KnowledgeRow = { id: string; name: string; description: string; exam_cue: string };
type AnalysisRunRow = {
  id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  attempt_count: number;
  latency_ms: number;
};

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableId(prefix: string, value: string) {
  return `${prefix}:${encodeURIComponent(normalizeName(value)).slice(0, 180)}`;
}

function extractOptionContent(original: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = original.match(new RegExp(`(?:^|\\n)\\s*${escaped}[.、)]\\s*([\\s\\S]*?)(?=\\n\\s*[A-H][.、)]\\s*|$)`, "i"));
  return match?.[1]?.trim() ?? null;
}

async function hydrateQuestion(row: QuestionRow): Promise<SavedQuestion> {
  const d1 = getD1();
  const [optionsResult, tagResult, knowledgeResult, analysisResult] = await d1.batch([
    d1.prepare("SELECT label, content, explanation, is_correct FROM question_options WHERE question_id = ? ORDER BY sort_order, id").bind(row.id),
    d1.prepare(`SELECT t.name, t.kind FROM tags t
      INNER JOIN question_tags qt ON qt.tag_id = t.id
      WHERE qt.question_id = ? ORDER BY t.kind, t.name`).bind(row.id),
    d1.prepare(`SELECT k.id, k.name, k.description, k.exam_cue FROM knowledge_points k
      INNER JOIN question_knowledge_points qk ON qk.knowledge_point_id = k.id
      WHERE qk.question_id = ? ORDER BY qk.sort_order, k.name`).bind(row.id),
    d1.prepare(`SELECT id, model, prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, attempt_count, latency_ms
      FROM ai_analysis_runs WHERE question_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`)
      .bind(row.id),
  ]);

  const options = (optionsResult.results ?? []) as OptionRow[];
  const tags = (tagResult.results ?? []) as TagRow[];
  const knowledgeRows = (knowledgeResult.results ?? []) as KnowledgeRow[];
  const analysisRun = analysisResult.results?.[0] as AnalysisRunRow | undefined;
  return {
    id: row.id,
    sequence: row.sequence,
    original: row.original_text,
    title: row.title,
    mastery: row.mastery,
    familiarity: Math.min(5, Math.max(0, row.familiarity ?? 0)),
    createdAt: row.created_at,
    analysisRunId: analysisRun?.id,
    analysisMeta: analysisRun && (analysisRun.total_tokens > 0 || analysisRun.latency_ms > 0) ? {
      model: analysisRun.model,
      promptTokens: analysisRun.prompt_tokens,
      completionTokens: analysisRun.completion_tokens,
      reasoningTokens: analysisRun.reasoning_tokens,
      totalTokens: analysisRun.total_tokens,
      attemptCount: analysisRun.attempt_count,
      latencyMs: analysisRun.latency_ms,
    } : undefined,
    analysis: {
      title: row.title,
      answer: row.answer,
      summary: row.summary,
      services: tags.filter((tag) => tag.kind === "service").map((tag) => tag.name),
      topics: tags.filter((tag) => tag.kind === "topic").map((tag) => tag.name),
      keywords: tags.filter((tag) => tag.kind === "keyword").map((tag) => tag.name),
      optionNotes: options.map((option) => ({ label: option.label, content: option.content ?? undefined, correct: Boolean(option.is_correct), text: option.explanation })),
      knowledge: knowledgeRows.map((item) => ({ id: item.id, title: item.name, body: item.description, cue: item.exam_cue })),
    },
  };
}

export async function listQuestions(input: {
  search?: string;
  mastery?: "all" | SavedQuestion["mastery"];
  limit?: number;
  offset?: number;
} = {}) {
  await ensureDatabase();
  const d1 = getD1();
  const concepts = getSearchConcepts(input.search ?? "");
  const mastery = input.mastery ?? "all";
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);
  const documentCte = `searchable_questions AS (
      SELECT q.*,
        lower(q.title) AS title_search,
        lower(q.original_text) AS original_search,
        lower(q.summary) AS summary_search,
        lower(COALESCE((SELECT group_concat(t.name, ' ') FROM question_tags qt INNER JOIN tags t ON t.id = qt.tag_id WHERE qt.question_id = q.id), '')) AS tags_search,
        lower(COALESCE((SELECT group_concat(k.name || ' ' || k.description || ' ' || k.exam_cue, ' ') FROM question_knowledge_points qk INNER JOIN knowledge_points k ON k.id = qk.knowledge_point_id WHERE qk.question_id = q.id), '')) AS knowledge_search
      FROM numbered_questions q
    )`;
  const allFields = "(q.title_search || ' ' || q.original_search || ' ' || q.summary_search || ' ' || q.tags_search || ' ' || q.knowledge_search)";
  const searchBindings: string[] = [];
  const conceptClauses = concepts.map((alternatives) => {
    const clause = alternatives.map(() => `${allFields} LIKE ?`).join(" OR ");
    searchBindings.push(...alternatives.map((term) => `%${term}%`));
    return `(${clause})`;
  });
  const whereClause = `${conceptClauses.length ? conceptClauses.join(" AND ") : "1 = 1"} AND (? = 'all' OR q.mastery = ?)`;
  const scoreBindings: string[] = [];
  const scoreParts = concepts.map((alternatives) => {
    const fieldScore = (field: string, score: number) => {
      scoreBindings.push(...alternatives.map((term) => `%${term}%`));
      return `CASE WHEN (${alternatives.map(() => `${field} LIKE ?`).join(" OR ")}) THEN ${score} ELSE 0 END`;
    };
    return `(${fieldScore("q.title_search", 50)} + ${fieldScore("q.tags_search", 30)} + ${fieldScore("q.knowledge_search", 24)} + ${fieldScore("q.summary_search", 12)} + ${fieldScore("q.original_search", 8)})`;
  });
  const relevanceSql = scoreParts.length ? scoreParts.join(" + ") : "0";
  const whereBindings = [...searchBindings, mastery, mastery];
  const [rows, countRow] = await Promise.all([
    d1.prepare(`WITH numbered_questions AS (
      SELECT q.*, ROW_NUMBER() OVER (ORDER BY q.created_at ASC, q.id ASC) AS sequence FROM questions q
    ), ${documentCte}
    SELECT q.id, q.sequence, q.original_text, q.title, q.answer, q.summary, q.mastery, q.familiarity, q.created_at, ${relevanceSql} AS relevance
    FROM searchable_questions q WHERE ${whereClause}
    ORDER BY relevance DESC, q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`)
      .bind(...scoreBindings, ...whereBindings, limit, offset).all<QuestionRow>(),
    d1.prepare(`WITH numbered_questions AS (
      SELECT q.*, ROW_NUMBER() OVER (ORDER BY q.created_at ASC, q.id ASC) AS sequence FROM questions q
    ), ${documentCte}
    SELECT COUNT(*) AS total FROM searchable_questions q WHERE ${whereClause}`)
      .bind(...whereBindings).first<{ total: number }>(),
  ]);
  return {
    questions: await Promise.all((rows.results ?? []).map(hydrateQuestion)),
    total: countRow?.total ?? 0,
  };
}

export async function getQuestion(id: string) {
  await ensureDatabase();
  const row = await getD1().prepare(`SELECT q.id, q.original_text, q.title, q.answer, q.summary, q.mastery, q.familiarity, q.created_at,
      1 + (SELECT COUNT(*) FROM questions older WHERE older.created_at < q.created_at
        OR (older.created_at = q.created_at AND older.id < q.id)) AS sequence
    FROM questions q WHERE q.id = ?`).bind(id).first<QuestionRow>();
  return row ? hydrateQuestion(row) : null;
}

export async function saveQuestion(input: SavedQuestion, systemPrompt: string) {
  await ensureDatabase();
  const d1 = getD1();
  const now = new Date().toISOString();
  const createdAt = input.createdAt || now;
  const statements = [
    d1.prepare(`INSERT INTO questions
      (id, original_text, title, answer, summary, status, mastery, familiarity, model, prompt_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, 'v1', ?, ?)
      ON CONFLICT(id) DO UPDATE SET original_text = excluded.original_text, title = excluded.title,
      answer = excluded.answer, summary = excluded.summary, model = excluded.model, mastery = excluded.mastery,
      familiarity = excluded.familiarity, updated_at = excluded.updated_at`)
      .bind(input.id, input.original, input.analysis.title, input.analysis.answer, input.analysis.summary,
        input.mastery ?? "unreviewed", Math.min(5, Math.max(0, input.familiarity ?? 0)), "deepseek-v4-flash", createdAt, now),
    d1.prepare("DELETE FROM question_options WHERE question_id = ?").bind(input.id),
    d1.prepare("DELETE FROM question_tags WHERE question_id = ?").bind(input.id),
    d1.prepare("DELETE FROM question_knowledge_points WHERE question_id = ?").bind(input.id),
  ];

  input.analysis.optionNotes.forEach((option, index) => {
    statements.push(d1.prepare(`INSERT INTO question_options
      (question_id, label, content, explanation, is_correct, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(input.id, option.label, extractOptionContent(input.original, option.label), option.text, option.correct ? 1 : 0, index));
  });

  const tagGroups: Array<["service" | "topic" | "keyword", string[]]> = [
    ["service", input.analysis.services], ["topic", input.analysis.topics], ["keyword", input.analysis.keywords],
  ];
  for (const [kind, names] of tagGroups) {
    for (const name of names) {
      const normalized = normalizeName(name);
      const id = stableId(`tag-${kind}`, name);
      statements.push(d1.prepare(`INSERT INTO tags (id, name, normalized_name, kind, status, created_at)
        VALUES (?, ?, ?, ?, 'candidate', ?) ON CONFLICT(kind, normalized_name) DO UPDATE SET name = excluded.name`)
        .bind(id, name, normalized, kind, now));
      statements.push(d1.prepare("INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)").bind(input.id, id));
    }
  }

  input.analysis.knowledge.forEach((knowledge, index) => {
    const normalized = normalizeName(knowledge.title);
    const id = stableId("knowledge", knowledge.title);
    statements.push(d1.prepare(`INSERT INTO knowledge_points
      (id, name, normalized_name, description, exam_cue, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name,
      description = CASE WHEN length(excluded.description) > length(knowledge_points.description) THEN excluded.description ELSE knowledge_points.description END,
      exam_cue = CASE WHEN length(excluded.exam_cue) > length(knowledge_points.exam_cue) THEN excluded.exam_cue ELSE knowledge_points.exam_cue END,
      updated_at = excluded.updated_at`)
      .bind(id, knowledge.title, normalized, knowledge.body, knowledge.cue, now, now));
    statements.push(d1.prepare(`INSERT OR IGNORE INTO question_knowledge_points
      (question_id, knowledge_point_id, sort_order) VALUES (?, ?, ?)`)
      .bind(input.id, id, index));
  });

  if (input.analysisRunId) {
    statements.push(d1.prepare(`UPDATE ai_analysis_runs SET question_id = ?, raw_response = ?, status = 'succeeded' WHERE id = ?`)
      .bind(input.id, JSON.stringify(input.analysis), input.analysisRunId));
  } else {
    statements.push(d1.prepare(`INSERT INTO ai_analysis_runs
      (id, question_id, provider, model, system_prompt_snapshot, raw_response, status, created_at)
      VALUES (?, ?, 'deepseek', 'deepseek-v4-flash', ?, ?, 'succeeded', ?)`)
      .bind(crypto.randomUUID(), input.id, systemPrompt, JSON.stringify(input.analysis), now));
  }

  statements.push(
    d1.prepare("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM question_tags qt WHERE qt.tag_id = tags.id)"),
    d1.prepare("DELETE FROM knowledge_points WHERE NOT EXISTS (SELECT 1 FROM question_knowledge_points qk WHERE qk.knowledge_point_id = knowledge_points.id)"),
  );

  await d1.batch(statements);
  return getQuestion(input.id);
}

export async function deleteQuestion(id: string) {
  await ensureDatabase();
  await getD1().prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
}

export async function updateMastery(id: string, mastery: SavedQuestion["mastery"]) {
  await ensureDatabase();
  const updatedAt = new Date().toISOString();
  const result = await getD1().prepare("UPDATE questions SET mastery = ?, updated_at = ? WHERE id = ?")
    .bind(mastery, updatedAt, id).run();
  if (!result.meta.changes) return null;
  return { id, mastery, updatedAt };
}

export async function updateFamiliarity(id: string, familiarity: number) {
  await ensureDatabase();
  const rating = Math.min(5, Math.max(0, Math.round(familiarity)));
  const updatedAt = new Date().toISOString();
  const result = await getD1().prepare("UPDATE questions SET familiarity = ?, updated_at = ? WHERE id = ?")
    .bind(rating, updatedAt, id).run();
  if (!result.meta.changes) return null;
  return { id, familiarity: rating, updatedAt };
}

export async function getFamiliarityStats() {
  await ensureDatabase();
  const rows = await getD1().prepare(`SELECT familiarity, COUNT(*) AS count
    FROM questions GROUP BY familiarity ORDER BY familiarity`).all<{ familiarity: number; count: number }>();
  const counts = Array.from({ length: 6 }, (_, familiarity) => ({ familiarity, count: 0 }));
  for (const row of rows.results ?? []) {
    const familiarity = Math.min(5, Math.max(0, Math.round(row.familiarity ?? 0)));
    counts[familiarity].count += Number(row.count) || 0;
  }
  return { total: counts.reduce((sum, item) => sum + item.count, 0), counts };
}

export async function getWeightedRandomQuestion(excludeIds: string[] = [], familiarity?: number) {
  await ensureDatabase();
  const allExclusions = new Set(excludeIds.filter(Boolean));
  const requestedFamiliarity = familiarity === undefined
    ? null
    : Math.min(5, Math.max(0, Math.round(familiarity)));
  const queryExclusions = Array.from(allExclusions).slice(-200);
  const clauses: string[] = [];
  const bindings: Array<string | number> = [];
  if (requestedFamiliarity !== null) {
    clauses.push("familiarity = ?");
    bindings.push(requestedFamiliarity);
  }
  if (queryExclusions.length) {
    clauses.push(`id NOT IN (${queryExclusions.map(() => "?").join(",")})`);
    bindings.push(...queryExclusions);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  if (requestedFamiliarity !== null) {
    const candidate = await getD1().prepare(`WITH candidate AS (
        SELECT id FROM questions ${where} ORDER BY RANDOM() LIMIT 1
      )
      SELECT q.id, q.original_text, q.title, q.answer, q.summary, q.mastery, q.familiarity, q.created_at,
        1 + (SELECT COUNT(*) FROM questions older WHERE older.created_at < q.created_at
          OR (older.created_at = q.created_at AND older.id < q.id)) AS sequence
      FROM questions q INNER JOIN candidate c ON c.id = q.id`)
      .bind(...bindings).first<QuestionRow>();
    return candidate ? hydrateQuestion(candidate) : null;
  }
  const rows = await getD1().prepare(`SELECT id, familiarity FROM questions ${where}`)
    .bind(...bindings).all<{ id: string; familiarity: number }>();
  const candidates = (rows.results ?? []).filter((item) => !allExclusions.has(item.id));
  if (!candidates.length) return null;
  const weighted = candidates.map((item) => ({ ...item, weight: familiarityWeight(item.familiarity ?? 0) }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
  let ticket = randomValue * totalWeight;
  for (const item of weighted) {
    ticket -= item.weight;
    if (ticket < 0) return getQuestion(item.id);
  }
  return getQuestion(weighted[weighted.length - 1].id);
}
