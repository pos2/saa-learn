import { ensureDatabase, getD1 } from "./init";
import { getQuestion } from "./questions";
import { getSearchConcepts } from "../lib/search";
import type { KnowledgePointDetail, KnowledgePointSummary } from "../lib/domain";

type KnowledgeRow = {
  id: string;
  name: string;
  description: string;
  exam_cue: string;
  question_count: number;
};

function toSummary(row: KnowledgeRow): KnowledgePointSummary {
  return { id: row.id, title: row.name, body: row.description, cue: row.exam_cue, questionCount: row.question_count };
}

export async function listKnowledgePoints(input: { search?: string; limit?: number; offset?: number } = {}) {
  await ensureDatabase();
  const d1 = getD1();
  const concepts = getSearchConcepts(input.search ?? "");
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);
  const bindings: string[] = [];
  const clauses = concepts.map((alternatives) => {
    bindings.push(...alternatives.map((term) => `%${term}%`));
    return `(${alternatives.map(() => "search_text LIKE ?").join(" OR ")})`;
  });
  const scoreBindings: string[] = [];
  const scoreParts = concepts.map((alternatives) => {
    scoreBindings.push(...alternatives.map((term) => `%${term}%`));
    const nameClause = alternatives.map(() => "lower(name) LIKE ?").join(" OR ");
    return `CASE WHEN (${nameClause}) THEN 30 ELSE 5 END`;
  });
  const whereSql = clauses.length ? clauses.join(" AND ") : "1 = 1";
  const scoreSql = scoreParts.length ? scoreParts.join(" + ") : "0";
  const baseCte = `knowledge_search AS (
    SELECT k.id, k.name, k.description, k.exam_cue,
      lower(k.name || ' ' || k.description || ' ' || k.exam_cue) AS search_text,
      COUNT(qk.question_id) AS question_count
    FROM knowledge_points k LEFT JOIN question_knowledge_points qk ON qk.knowledge_point_id = k.id
    GROUP BY k.id, k.name, k.description, k.exam_cue
  )`;
  const [rows, count] = await Promise.all([
    d1.prepare(`WITH ${baseCte}
      SELECT id, name, description, exam_cue, question_count, ${scoreSql} AS relevance
      FROM knowledge_search WHERE ${whereSql}
      ORDER BY relevance DESC, question_count DESC, name ASC LIMIT ? OFFSET ?`)
      .bind(...scoreBindings, ...bindings, limit, offset).all<KnowledgeRow>(),
    d1.prepare(`WITH ${baseCte} SELECT COUNT(*) AS total FROM knowledge_search WHERE ${whereSql}`)
      .bind(...bindings).first<{ total: number }>(),
  ]);
  return { knowledgePoints: (rows.results ?? []).map(toSummary), total: count?.total ?? 0 };
}

export async function getKnowledgePoint(id: string): Promise<KnowledgePointDetail | null> {
  await ensureDatabase();
  const d1 = getD1();
  const row = await d1.prepare(`SELECT k.id, k.name, k.description, k.exam_cue, COUNT(qk.question_id) AS question_count
    FROM knowledge_points k LEFT JOIN question_knowledge_points qk ON qk.knowledge_point_id = k.id
    WHERE k.id = ? GROUP BY k.id, k.name, k.description, k.exam_cue`).bind(id).first<KnowledgeRow>();
  if (!row) return null;
  const related = await d1.prepare(`SELECT q.id FROM questions q
    INNER JOIN question_knowledge_points qk ON qk.question_id = q.id
    WHERE qk.knowledge_point_id = ? ORDER BY q.created_at DESC, q.id DESC LIMIT 100`)
    .bind(id).all<{ id: string }>();
  const relatedQuestions = (await Promise.all((related.results ?? []).map((item) => getQuestion(item.id))))
    .filter((question) => question !== null);
  return { ...toSummary(row), relatedQuestions };
}
