#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaxonomyCatalog } from "../lib/taxonomy-ai.ts";

type TagItem = TaxonomyCatalog["tags"][number];
type Batch =
  | { type: "tags"; label: string; tags: Array<{ kind: TagItem["kind"]; name: string }> }
  | { type: "knowledge"; label: string; knowledgeTitles: string[] };
type ProgressState = {
  version: 1;
  sourceCounts: { tags: number; knowledge: number };
  batches: Batch[];
  nextBatch: number;
  totals: { tagGroups: number; knowledgeGroups: number; statements: number; tokens: number };
};

const STATE_PATH = resolve(".wrangler/taxonomy-consolidation-state.json");

const serviceSignals: Array<[string, RegExp]> = [
  ["s3", /\bs3\b|simple storage|对象存储/i], ["ec2", /\bec2\b|elastic compute|实例/i],
  ["vpc", /\bvpc\b|virtual private|子网|路由表/i], ["iam", /\biam\b|identity and access|权限|策略/i],
  ["rds", /\brds\b|aurora|关系数据库/i], ["dynamodb", /dynamodb/i], ["lambda", /lambda|无服务器/i],
  ["cloudfront", /cloudfront|cdn/i], ["elb", /load balancer|\belb\b|负载均衡/i], ["route53", /route\s*53|dns/i],
  ["cloudwatch", /cloudwatch|监控|日志|告警/i], ["sqs", /\bsqs\b|queue|队列/i], ["sns", /\bsns\b|notification|通知/i],
  ["eventbridge", /eventbridge|事件总线/i], ["kinesis", /kinesis|流数据/i], ["redshift", /redshift|数据仓库/i],
  ["athena", /athena|按需查询/i], ["glue", /\bglue\b|数据目录/i], ["emr", /\bemr\b|mapreduce|spark/i],
  ["efs", /\befs\b|elastic file/i], ["ebs", /\bebs\b|elastic block/i], ["kms", /\bkms\b|密钥管理/i],
  ["waf", /\bwaf\b|web application firewall/i], ["organizations", /organizations|组织/i],
  ["migration", /snowball|datasync|storage gateway|迁移|传输/i], ["general", /./],
];

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
}

function semanticKey(value: string) {
  const signal = serviceSignals.find(([, pattern]) => pattern.test(value))?.[0] ?? "general";
  return `${signal}|${normalized(value)}`;
}

function knowledgeCandidateKey(value: string) {
  return normalized(value
    .replace(/生命周期(?:策略|规则)?/g, " lifecycle ")
    .replace(/多可用区(?:部署)?/g, " multi az ")
    .replace(/只读副本/g, " read replica ")
    .replace(/文件网关/g, " file gateway ")
    .replace(/网关端点/g, " gateway endpoint ")
    .replace(/跨区域复制/g, " cross region replication ")
    .replace(/自动(?:扩缩容|扩展)/g, " auto scaling "))
    .split(" ")
    .filter((token) => !new Set(["aws", "amazon", "the", "的", "功能", "机制", "服务", "部署", "策略", "规则", "配置", "概述"]).has(token))
    .map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .join(" ");
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result.filter((batch) => batch.length >= 2);
}

export function createBatches(catalog: TaxonomyCatalog, tagBatchSize: number, knowledgeBatchSize: number): Batch[] {
  const batches: Batch[] = [];
  for (const kind of ["service", "topic", "keyword"] as const) {
    const items = catalog.tags.filter((item) => item.kind === kind).sort((a, b) => semanticKey(a.name).localeCompare(semanticKey(b.name)));
    chunks(items, tagBatchSize).forEach((batch, index) => batches.push({
      type: "tags",
      label: `${kind} ${index + 1}/${Math.ceil(items.length / tagBatchSize)}`,
      tags: batch.map((item) => ({ kind: item.kind, name: item.name })),
    }));
  }
  const knowledge = [...catalog.knowledge].sort((a, b) => semanticKey(`${a.title} ${a.body}`).localeCompare(semanticKey(`${b.title} ${b.body}`)));
  chunks(knowledge, knowledgeBatchSize).forEach((batch, index) => batches.push({
    type: "knowledge",
    label: `knowledge ${index + 1}/${Math.ceil(knowledge.length / knowledgeBatchSize)}`,
    knowledgeTitles: batch.map((item) => item.title),
  }));
  return batches;
}


export function createKnowledgeCandidateBatches(catalog: TaxonomyCatalog, knowledgeBatchSize: number): Batch[] {
  const groups = new Map<string, string[]>();
  for (const item of catalog.knowledge) {
    const key = knowledgeCandidateKey(item.title);
    if (!key) continue;
    const values = groups.get(key) ?? [];
    values.push(item.title);
    groups.set(key, values);
  }
  const candidates = Array.from(groups.entries())
    .filter(([, titles]) => titles.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b));
  const batches: Batch[] = [];
  let current: string[] = [];
  for (const [, titles] of candidates) {
    if (current.length && current.length + titles.length > knowledgeBatchSize) {
      batches.push({ type: "knowledge", label: `knowledge candidates ${batches.length + 1}`, knowledgeTitles: current });
      current = [];
    }
    current.push(...titles);
  }
  if (current.length >= 2) batches.push({ type: "knowledge", label: `knowledge candidates ${batches.length + 1}`, knowledgeTitles: current });
  return batches;
}

function parseArgs(argv: string[]) {
  const valueOf = (name: string) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const integer = (name: string, fallback: number) => {
    const value = Number.parseInt(valueOf(name) ?? String(fallback), 10);
    if (!Number.isFinite(value) || value < 2) throw new Error(`--${name} 必须是大于 1 的整数`);
    return value;
  };
  return {
    baseUrl: (valueOf("base-url") ?? "http://localhost:3000").replace(/\/$/, ""),
    tagBatchSize: Math.min(integer("tag-batch", 280), 320),
    knowledgeBatchSize: Math.min(integer("knowledge-batch", 100), 120),
    delayMs: Number.parseInt(valueOf("delay") ?? "650", 10),
    dryRun: argv.includes("--dry-run"),
    restart: argv.includes("--restart"),
    candidatePass: argv.includes("--candidate-pass"),
  };
}

async function consolidateBatch(baseUrl: string, batch: Batch) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await jsonRequest<{ tagGroups: number; knowledgeGroups: number; statements: number; totalTokens: number }>(
        `${baseUrl}/api/taxonomy/consolidate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch.type === "tags" ? { tags: batch.tags } : { knowledgeTitles: batch.knowledgeTitles }),
        },
      );
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`本批请求失败，将进行第 ${attempt + 1} 次尝试：${error instanceof Error ? error.message : error}`);
        await wait(1_500 * attempt);
      }
    }
  }
  throw lastError;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

async function saveState(state: ProgressState) {
  await mkdir(resolve(".wrangler"), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8")) as ProgressState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const wait = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error("--delay 必须是非负整数");
  if (options.restart) await unlink(STATE_PATH).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  let state = await loadState();
  if (!state) {
    const catalog = await jsonRequest<TaxonomyCatalog>(`${options.baseUrl}/api/taxonomy/consolidate`);
    const batches = options.candidatePass
      ? createKnowledgeCandidateBatches(catalog, options.knowledgeBatchSize)
      : createBatches(catalog, options.tagBatchSize, options.knowledgeBatchSize);
    state = {
      version: 1,
      sourceCounts: { tags: catalog.tags.length, knowledge: catalog.knowledge.length },
      batches,
      nextBatch: 0,
      totals: { tagGroups: 0, knowledgeGroups: 0, statements: 0, tokens: 0 },
    };
    if (!options.dryRun) await saveState(state);
  }
  console.log(`分类目录：${state.sourceCounts.tags} 个标签，${state.sourceCounts.knowledge} 个知识点，共 ${state.batches.length} 个 AI 批次。`);
  if (options.dryRun) {
    console.log("DRY RUN 完成：未调用 DeepSeek，也未修改数据库。");
    return;
  }
  if (state.nextBatch) console.log(`从批次 ${state.nextBatch + 1} 继续，前 ${state.nextBatch} 个批次已经完成。`);
  let index = state.nextBatch;
  while (index < state.batches.length) {
    const batch = state.batches[index];
    const identity = createHash("sha256").update(JSON.stringify(batch)).digest("hex").slice(0, 8);
    console.log(`[${index + 1}/${state.batches.length}] ${batch.label} (${identity})…`);
    let payload: Awaited<ReturnType<typeof consolidateBatch>>;
    try {
      payload = await consolidateBatch(options.baseUrl, batch);
    } catch (error) {
      const itemCount = batch.type === "tags" ? batch.tags.length : batch.knowledgeTitles.length;
      if (itemCount <= 40) throw error;
      const midpoint = Math.ceil(itemCount / 2);
      const halves: [Batch, Batch] = batch.type === "tags"
        ? [
            { type: "tags", label: `${batch.label} · 1/2`, tags: batch.tags.slice(0, midpoint) },
            { type: "tags", label: `${batch.label} · 2/2`, tags: batch.tags.slice(midpoint) },
          ]
        : [
            { type: "knowledge", label: `${batch.label} · 1/2`, knowledgeTitles: batch.knowledgeTitles.slice(0, midpoint) },
            { type: "knowledge", label: `${batch.label} · 2/2`, knowledgeTitles: batch.knowledgeTitles.slice(midpoint) },
          ];
      state.batches.splice(index, 1, ...halves);
      await saveState(state);
      console.warn(`本批连续失败，已自动拆为 ${halves[0].type === "tags" ? halves[0].tags.length : halves[0].knowledgeTitles.length} 和 ${halves[1].type === "tags" ? halves[1].tags.length : halves[1].knowledgeTitles.length} 项后继续。`);
      continue;
    }
    state.totals.tagGroups += payload.tagGroups;
    state.totals.knowledgeGroups += payload.knowledgeGroups;
    state.totals.statements += payload.statements;
    state.totals.tokens += payload.totalTokens;
    state.nextBatch = index + 1;
    await saveState(state);
    console.log(`完成：标签合并组 ${payload.tagGroups}，知识点合并组 ${payload.knowledgeGroups}，${payload.totalTokens} tokens。`);
    if (options.delayMs > 0) await wait(options.delayMs);
    index += 1;
  }
  const finalCatalog = await jsonRequest<TaxonomyCatalog>(`${options.baseUrl}/api/taxonomy/consolidate`);
  await unlink(STATE_PATH);
  console.log(`\n分批归并完成：标签 ${state.sourceCounts.tags} → ${finalCatalog.tags.length}，知识点 ${state.sourceCounts.knowledge} → ${finalCatalog.knowledge.length}。`);
  console.log(`累计合并：标签组 ${state.totals.tagGroups}，知识点组 ${state.totals.knowledgeGroups}，使用 ${state.totals.tokens} tokens。`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error("进度已保留；修复问题后重新执行相同命令即可继续。使用 --restart 可从头重新生成批次。");
    process.exitCode = 1;
  });
}
