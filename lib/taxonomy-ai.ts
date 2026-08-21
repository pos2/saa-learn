import type { Analysis } from "./domain.ts";
import { canonicalizeAnalysis } from "./taxonomy.ts";

export type TaxonomyCatalog = {
  tags: Array<{ kind: "service" | "topic" | "keyword"; name: string; count: number }>;
  knowledge: Array<{ title: string; body: string; cue: string; count: number }>;
};

export type TaxonomyMergePlan = {
  tagGroups: Array<{ kind: "service" | "topic" | "keyword"; canonicalName: string; members: string[] }>;
  knowledgeGroups: Array<{ canonicalTitle: string; members: string[]; body: string; cue: string }>;
};

const validKinds = new Set(["service", "topic", "keyword"]);

function strings(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
}

export function sanitizeTaxonomyMergePlan(value: unknown, catalog: TaxonomyCatalog): unknown {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tagCounts = new Map(catalog.tags.map((item) => [`${item.kind}:${item.name}`, item.count]));
  const knowledgeByTitle = new Map(catalog.knowledge.map((item) => [item.title, item]));
  const usedTags = new Set<string>();
  const usedKnowledge = new Set<string>();
  const tagGroups = (Array.isArray(input.tagGroups) ? input.tagGroups : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const group = raw as Record<string, unknown>;
    const kind = typeof group.kind === "string" && validKinds.has(group.kind) ? group.kind as "service" | "topic" | "keyword" : null;
    if (!kind) return [];
    const members = strings(group.members).filter((member) => tagCounts.has(`${kind}:${member}`) && !usedTags.has(`${kind}:${member}`));
    if (members.length < 2) return [];
    const requestedCanonical = typeof group.canonicalName === "string" ? group.canonicalName.trim() : "";
    const canonicalName = members.includes(requestedCanonical)
      ? requestedCanonical
      : [...members].sort((a, b) => (tagCounts.get(`${kind}:${b}`) ?? 0) - (tagCounts.get(`${kind}:${a}`) ?? 0))[0];
    members.forEach((member) => usedTags.add(`${kind}:${member}`));
    return [{ kind, canonicalName, members }];
  });
  const knowledgeGroups = (Array.isArray(input.knowledgeGroups) ? input.knowledgeGroups : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const group = raw as Record<string, unknown>;
    const members = strings(group.members).filter((member) => knowledgeByTitle.has(member) && !usedKnowledge.has(member));
    if (members.length < 2) return [];
    const requestedCanonical = typeof group.canonicalTitle === "string" ? group.canonicalTitle.trim() : "";
    const canonicalTitle = members.includes(requestedCanonical)
      ? requestedCanonical
      : [...members].sort((a, b) => (knowledgeByTitle.get(b)?.count ?? 0) - (knowledgeByTitle.get(a)?.count ?? 0))[0];
    const fallback = knowledgeByTitle.get(canonicalTitle)!;
    const proposedBody = typeof group.body === "string" ? group.body.trim() : "";
    const proposedCue = typeof group.cue === "string" ? group.cue.trim() : "";
    const body = /[\u3400-\u9fff]/.test(proposedBody) ? proposedBody : fallback.body;
    const cue = /[\u3400-\u9fff]/.test(proposedCue) ? proposedCue : fallback.cue;
    if (!body || !cue || !/[\u3400-\u9fff]/.test(`${body}${cue}`)) return [];
    members.forEach((member) => usedKnowledge.add(member));
    return [{ canonicalTitle, members, body, cue }];
  });
  return { tagGroups, knowledgeGroups };
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`AI 去重方案的 ${field} 不完整`);
  return value.trim();
}

function requireMembers(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`AI 去重方案的 ${field} 必须是数组`);
  const members = Array.from(new Set(value.map((item) => requireString(item, field))));
  if (members.length < 2) throw new Error(`AI 去重方案的 ${field} 至少需要两个同义项`);
  return members;
}

export function parseTaxonomyMergePlan(value: unknown, catalog: TaxonomyCatalog): TaxonomyMergePlan {
  if (!value || typeof value !== "object") throw new Error("AI 没有返回有效的知识归并 JSON");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.tagGroups) || !Array.isArray(input.knowledgeGroups)) throw new Error("AI 去重方案缺少 tagGroups 或 knowledgeGroups");
  const knownTags = new Map<string, Set<string>>();
  for (const kind of validKinds) knownTags.set(kind, new Set(catalog.tags.filter((item) => item.kind === kind).map((item) => item.name)));
  const usedTags = new Set<string>();
  const tagGroups = input.tagGroups.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`tagGroups[${index}] 格式不正确`);
    const group = raw as Record<string, unknown>;
    const kind = requireString(group.kind, `tagGroups[${index}].kind`) as TaxonomyMergePlan["tagGroups"][number]["kind"];
    if (!validKinds.has(kind)) throw new Error(`tagGroups[${index}] 的 kind 不正确`);
    const canonicalName = requireString(group.canonicalName, `tagGroups[${index}].canonicalName`);
    const members = requireMembers(group.members, `tagGroups[${index}].members`);
    if (!members.includes(canonicalName)) throw new Error(`tagGroups[${index}] 的规范名称必须来自现有成员`);
    for (const member of members) {
      if (!knownTags.get(kind)?.has(member)) throw new Error(`AI 引用了不存在的 ${kind} 标签：${member}`);
      const identity = `${kind}:${member}`;
      if (usedTags.has(identity)) throw new Error(`AI 将同一标签放入多个合并组：${member}`);
      usedTags.add(identity);
    }
    return { kind, canonicalName, members };
  });

  const knownKnowledge = new Set(catalog.knowledge.map((item) => item.title));
  const usedKnowledge = new Set<string>();
  const knowledgeGroups = input.knowledgeGroups.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`knowledgeGroups[${index}] 格式不正确`);
    const group = raw as Record<string, unknown>;
    const canonicalTitle = requireString(group.canonicalTitle, `knowledgeGroups[${index}].canonicalTitle`);
    const members = requireMembers(group.members, `knowledgeGroups[${index}].members`);
    const body = requireString(group.body, `knowledgeGroups[${index}].body`);
    const cue = requireString(group.cue, `knowledgeGroups[${index}].cue`);
    if (!members.includes(canonicalTitle)) throw new Error(`knowledgeGroups[${index}] 的规范名称必须来自现有成员`);
    if (!/[\u3400-\u9fff]/.test(`${body}${cue}`)) throw new Error(`knowledgeGroups[${index}] 的归纳内容必须使用中文`);
    for (const member of members) {
      if (!knownKnowledge.has(member)) throw new Error(`AI 引用了不存在的知识点：${member}`);
      if (usedKnowledge.has(member)) throw new Error(`AI 将同一知识点放入多个合并组：${member}`);
      usedKnowledge.add(member);
    }
    return { canonicalTitle, members, body, cue };
  });
  return { tagGroups, knowledgeGroups };
}

export function applyTaxonomyMergePlan(analysis: Analysis, plan: TaxonomyMergePlan) {
  const tagMaps = new Map<string, Map<string, string>>();
  for (const group of plan.tagGroups) {
    const mapping = tagMaps.get(group.kind) ?? new Map<string, string>();
    for (const member of group.members) mapping.set(member, group.canonicalName);
    tagMaps.set(group.kind, mapping);
  }
  const knowledgeMap = new Map<string, TaxonomyMergePlan["knowledgeGroups"][number]>();
  for (const group of plan.knowledgeGroups) for (const member of group.members) knowledgeMap.set(member, group);
  const unique = (values: string[]) => Array.from(new Set(values));
  const knowledge = new Map<string, Analysis["knowledge"][number]>();
  for (const point of analysis.knowledge) {
    const group = knowledgeMap.get(point.title);
    const merged = group ? { title: group.canonicalTitle, body: group.body, cue: group.cue } : { title: point.title, body: point.body, cue: point.cue };
    knowledge.set(merged.title, merged);
  }
  return canonicalizeAnalysis({
    ...analysis,
    services: unique(analysis.services.map((value) => tagMaps.get("service")?.get(value) ?? value)),
    topics: unique(analysis.topics.map((value) => tagMaps.get("topic")?.get(value) ?? value)),
    keywords: unique(analysis.keywords.map((value) => tagMaps.get("keyword")?.get(value) ?? value)),
    knowledge: Array.from(knowledge.values()),
  });
}
