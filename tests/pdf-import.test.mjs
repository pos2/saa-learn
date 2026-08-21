import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestionLines } from "../scripts/import-pdf-questions.ts";
import { canonicalizeAnalysis } from "../lib/taxonomy.ts";
import { applyTaxonomyMergePlan, parseTaxonomyMergePlan, sanitizeTaxonomyMergePlan } from "../lib/taxonomy-ai.ts";
import { createKnowledgeCandidateBatches } from "../scripts/consolidate-taxonomy.ts";
import { familiarityWeight } from "../lib/study.ts";

test("parses wrapped PDF text into complete questions", () => {
  const lines = [
    { page: 1, y: 10, text: "Question #1 Topic 1" },
    { page: 1, y: 9, text: "A company stores data in Amazon S3." },
    { page: 1, y: 8, text: "Which solution has the least overhead?" },
    { page: 1, y: 7, text: "A. Use Amazon EC2 and" },
    { page: 1, y: 6, text: "manage the servers." },
    { page: 1, y: 5, text: "B. Use Amazon Athena." },
    { page: 1, y: 4, text: "C. Use Amazon Redshift." },
    { page: 1, y: 3, text: "D. Use AWS Glue." },
  ];
  assert.deepEqual(parseQuestionLines(lines), {
    questions: [{
      sourceNumber: 1,
      original: "A company stores data in Amazon S3. Which solution has the least overhead?\n\nA. Use Amazon EC2 and manage the servers.\nB. Use Amazon Athena.\nC. Use Amazon Redshift.\nD. Use AWS Glue.",
    }],
    skipped: [],
  });
});

test("parses a complete four-option question", () => {
  const lines = [
    { page: 1, y: 10, text: "Question #2 Topic 1" },
    { page: 1, y: 9, text: "Which service should the company use?" },
    { page: 1, y: 8, text: "A. Use Amazon EC2." },
    { page: 1, y: 7, text: "B. Use Amazon Athena." },
    { page: 1, y: 6, text: "C. Use Amazon Redshift." },
    { page: 1, y: 5, text: "D. Use AWS Glue." },
  ];
  assert.deepEqual(parseQuestionLines(lines), {
    questions: [{
      sourceNumber: 2,
      original: "Which service should the company use?\n\nA. Use Amazon EC2.\nB. Use Amazon Athena.\nC. Use Amazon Redshift.\nD. Use AWS Glue.",
    }],
    skipped: [],
  });
});

test("skips image-only options instead of stopping the batch", () => {
  const lines = [
    { page: 480, y: 10, text: "Question #477 Topic 1" },
    { page: 480, y: 9, text: "Which IAM statement should be added?" },
    { page: 480, y: 8, text: "A." },
    { page: 480, y: 7, text: "B." },
    { page: 480, y: 6, text: "C." },
    { page: 481, y: 5, text: "C." },
    { page: 481, y: 4, text: "D." },
  ];
  assert.deepEqual(parseQuestionLines(lines), {
    questions: [],
    skipped: [{
      sourceNumber: 477,
      pages: [480, 481],
      reason: "选项内容无法从 PDF 文本层提取，可能是图片或截图",
    }],
  });
});

test("canonicalizes synonymous taxonomy names", () => {
  const analysis = canonicalizeAnalysis({
    title: "测试",
    answer: "B",
    summary: "测试结论",
    services: ["AWS S3", "Amazon S3", "Athena"],
    topics: ["最低运营开销", "按需 SQL 数据分析"],
    keywords: ["S3", "AWS S3"],
    optionNotes: [],
    knowledge: [
      { title: "Amazon S3 Transfer Acceleration", body: "较短", cue: "线索" },
      { title: "S3 传输加速", body: "更完整的讲解", cue: "更完整的线索" },
    ],
  });
  assert.deepEqual(analysis.services, ["Amazon S3", "Amazon Athena"]);
  assert.deepEqual(analysis.topics, ["运维复杂度优化", "数据分析"]);
  assert.deepEqual(analysis.keywords, ["Amazon S3"]);
  assert.equal(analysis.knowledge.length, 1);
  assert.equal(analysis.knowledge[0].title, "S3 Transfer Acceleration");
  assert.equal(analysis.knowledge[0].body, "更完整的讲解");
});

test("validates and applies an AI taxonomy merge plan", () => {
  const catalog = {
    tags: [
      { kind: "keyword", name: "跨区域复制", count: 1 },
      { kind: "keyword", name: "Cross-Region Replication", count: 1 },
    ],
    knowledge: [
      { title: "Athena 查询 S3", body: "旧讲解", cue: "旧线索", count: 1 },
      { title: "使用 Athena 查询 S3", body: "另一份讲解", cue: "另一份线索", count: 1 },
    ],
  };
  const plan = parseTaxonomyMergePlan({
    tagGroups: [{ kind: "keyword", canonicalName: "跨区域复制", members: ["跨区域复制", "Cross-Region Replication"] }],
    knowledgeGroups: [{
      canonicalTitle: "Athena 查询 S3",
      members: ["Athena 查询 S3", "使用 Athena 查询 S3"],
      body: "Athena 可以直接使用 SQL 查询 S3 中的数据。",
      cue: "看到按需查询 S3 且要求低运维时选择 Athena。",
    }],
  }, catalog);
  const merged = applyTaxonomyMergePlan({
    title: "测试", answer: "A", summary: "测试结论", services: [], topics: [],
    keywords: ["Cross-Region Replication"], optionNotes: [],
    knowledge: [{ title: "使用 Athena 查询 S3", body: "另一份讲解", cue: "另一份线索" }],
  }, plan);
  assert.deepEqual(merged.keywords, ["跨区域复制"]);
  assert.deepEqual(merged.knowledge, [{
    id: undefined,
    title: "Amazon Athena Querying S3",
    body: "Athena 可以直接使用 SQL 查询 S3 中的数据。",
    cue: "看到按需查询 S3 且要求低运维时选择 Athena。",
  }]);
});

test("rejects AI merge plans that invent taxonomy members", () => {
  assert.throws(() => parseTaxonomyMergePlan({
    tagGroups: [{ kind: "service", canonicalName: "Amazon S3", members: ["Amazon S3", "Invented S3"] }],
    knowledgeGroups: [],
  }, { tags: [{ kind: "service", name: "Amazon S3", count: 1 }], knowledge: [] }), /不存在/);
});

test("sanitizes invented taxonomy names before strict validation", () => {
  const catalog = {
    tags: [
      { kind: "keyword", name: "Amazon EC2", count: 8 },
      { kind: "keyword", name: "EC2", count: 3 },
    ],
    knowledge: [],
  };
  const sanitized = sanitizeTaxonomyMergePlan({
    tagGroups: [{ kind: "keyword", canonicalName: "EC2 多实例", members: ["Amazon EC2", "EC2", "EC2 多实例"] }],
    knowledgeGroups: [],
  }, catalog);
  assert.deepEqual(parseTaxonomyMergePlan(sanitized, catalog).tagGroups, [{
    kind: "keyword", canonicalName: "Amazon EC2", members: ["Amazon EC2", "EC2"],
  }]);
});

test("groups only highly similar knowledge titles for candidate review", () => {
  const batches = createKnowledgeCandidateBatches({ tags: [], knowledge: [
    { title: "Amazon RDS Multi-AZ", body: "", cue: "", count: 2 },
    { title: "Amazon RDS Multi-AZ 部署", body: "", cue: "", count: 1 },
    { title: "Amazon RDS Read Replica", body: "", cue: "", count: 1 },
  ] }, 100);
  assert.deepEqual(batches.map((batch) => batch.knowledgeTitles), [["Amazon RDS Multi-AZ", "Amazon RDS Multi-AZ 部署"]]);
});

test("weights low-familiarity questions more heavily for random review", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(familiarityWeight), [36, 25, 16, 9, 4, 1]);
});
