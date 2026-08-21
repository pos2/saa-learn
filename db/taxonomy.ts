import { ensureDatabase, getD1 } from "./init";
import type { TaxonomyCatalog, TaxonomyMergePlan } from "../lib/taxonomy-ai";

type TagCatalogRow = { kind: "service" | "topic" | "keyword"; name: string; item_count: number };
type KnowledgeCatalogRow = { title: string; body: string; cue: string; item_count: number };

export async function getTaxonomyCatalog(): Promise<TaxonomyCatalog> {
  await ensureDatabase();
  const d1 = getD1();
  const [tags, knowledge] = await Promise.all([
    d1.prepare(`SELECT t.kind, t.name, COUNT(qt.question_id) AS item_count
      FROM tags t INNER JOIN question_tags qt ON qt.tag_id = t.id
      GROUP BY t.id, t.kind, t.name ORDER BY t.kind, t.name`).all<TagCatalogRow>(),
    d1.prepare(`SELECT k.name AS title, k.description AS body, k.exam_cue AS cue,
        COUNT(qk.question_id) AS item_count
      FROM knowledge_points k INNER JOIN question_knowledge_points qk ON qk.knowledge_point_id = k.id
      GROUP BY k.id, k.name, k.description, k.exam_cue ORDER BY k.name`).all<KnowledgeCatalogRow>(),
  ]);
  return {
    tags: (tags.results ?? []).map((item) => ({ kind: item.kind, name: item.name, count: item.item_count })),
    knowledge: (knowledge.results ?? []).map((item) => ({ title: item.title, body: item.body, cue: item.cue, count: item.item_count })),
  };
}

export async function applyTaxonomyPlan(plan: TaxonomyMergePlan) {
  await ensureDatabase();
  const d1 = getD1();
  const statements: ReturnType<typeof d1.prepare>[] = [];
  for (const group of plan.tagGroups) {
    for (const member of group.members) {
      if (member === group.canonicalName) continue;
      statements.push(
        d1.prepare(`INSERT OR IGNORE INTO question_tags (question_id, tag_id)
          SELECT qt.question_id, target.id FROM question_tags qt
          INNER JOIN tags source ON source.id = qt.tag_id
          CROSS JOIN tags target
          WHERE source.kind = ? AND source.name = ? AND target.kind = ? AND target.name = ?`)
          .bind(group.kind, member, group.kind, group.canonicalName),
        d1.prepare("DELETE FROM tags WHERE kind = ? AND name = ?").bind(group.kind, member),
      );
    }
  }
  const now = new Date().toISOString();
  for (const group of plan.knowledgeGroups) {
    statements.push(d1.prepare(`UPDATE knowledge_points SET description = ?, exam_cue = ?, updated_at = ? WHERE name = ?`)
      .bind(group.body, group.cue, now, group.canonicalTitle));
    for (const member of group.members) {
      if (member === group.canonicalTitle) continue;
      statements.push(
        d1.prepare(`INSERT OR IGNORE INTO question_knowledge_points (question_id, knowledge_point_id, sort_order)
          SELECT qk.question_id, target.id, qk.sort_order FROM question_knowledge_points qk
          INNER JOIN knowledge_points source ON source.id = qk.knowledge_point_id
          CROSS JOIN knowledge_points target
          WHERE source.name = ? AND target.name = ?`)
          .bind(member, group.canonicalTitle),
        d1.prepare("DELETE FROM knowledge_points WHERE name = ?").bind(member),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 80) await d1.batch(statements.slice(index, index + 80));
  await d1.prepare("PRAGMA optimize").run();
  return { statements: statements.length };
}
