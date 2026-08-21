#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeAnalysis } from "../lib/taxonomy.ts";
import type { Analysis, AnalysisMeta, SavedQuestion } from "../lib/domain.ts";

type PdfLine = { page: number; y: number; text: string };
type ParsedQuestion = { sourceNumber: number; original: string };
type SkippedQuestion = { sourceNumber: number; pages: number[]; reason: string };
type ParseResult = { questions: ParsedQuestion[]; skipped: SkippedQuestion[] };
type ImportOptions = {
  pdfPath: string;
  baseUrl: string;
  dryRun: boolean;
  limit?: number;
  startQuestion?: number;
  delayMs: number;
  consolidate: boolean;
  aiConsolidate: boolean;
  forceAiConsolidation: boolean;
};

function normalizeOriginal(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function questionHash(value: string) {
  return createHash("sha256").update(normalizeOriginal(value)).digest("hex");
}

function stableQuestionId(value: string) {
  return `pdf:${questionHash(value).slice(0, 32)}`;
}

function parseArguments(argv: string[]): ImportOptions {
  const pdfPath = argv.find((value) => !value.startsWith("--"));
  if (!pdfPath) throw new Error("用法：npm run import:pdf -- /path/to/questions.pdf [--dry-run] [--limit=10] [--start=1]");
  const valueOf = (name: string) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const numberOf = (name: string) => {
    const value = valueOf(name);
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} 必须是非负整数`);
    return parsed;
  };
  return {
    pdfPath: resolve(pdfPath),
    baseUrl: (valueOf("base-url") ?? "http://localhost:3000").replace(/\/$/, ""),
    dryRun: argv.includes("--dry-run"),
    limit: numberOf("limit"),
    startQuestion: numberOf("start"),
    delayMs: numberOf("delay") ?? 450,
    consolidate: !argv.includes("--skip-consolidation"),
    aiConsolidate: !argv.includes("--skip-consolidation") && !argv.includes("--skip-ai-consolidation"),
    forceAiConsolidation: argv.includes("--force-ai-consolidation"),
  };
}

async function extractPdfLines(pdfPath: string, startQuestion?: number, limit?: number): Promise<{ lines: PdfLine[]; pagesScanned: number }> {
  const extractor = resolve(fileURLToPath(new URL("./extract-pdf-text.py", import.meta.url)));
  const bundledPython = resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python");
  const candidates = [process.env.SAA_PDF_PYTHON, bundledPython, "python3"].filter((value): value is string => Boolean(value));
  let lastError = "";
  console.log(`正在扫描 PDF${limit ? `，最多读取 ${limit} 道题` : "全部页面"}…`);
  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, [extractor, pdfPath, startQuestion === undefined ? "" : String(startQuestion), limit === undefined ? "" : String(limit)], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (result.status === 0) return JSON.parse(result.stdout) as { lines: PdfLine[]; pagesScanned: number };
    lastError = result.stderr.trim();
    if (!/No module named ['"]pdfplumber/.test(lastError)) break;
  }
  throw new Error(lastError || "无法运行 PDF 文本提取器；请安装 Python 3 和 pdfplumber，或设置 SAA_PDF_PYTHON");
}

export function parseQuestionLines(lines: PdfLine[]): ParseResult {
  const questions: ParsedQuestion[] = [];
  const skipped: SkippedQuestion[] = [];
  let current: { sourceNumber: number; markerPage: number; lines: PdfLine[] } | null = null;
  const flush = () => {
    if (!current) return;
    const paragraphs: string[] = [];
    for (const line of current.lines) {
      if (/^[A-H][.、)](?:\s+|$)/.test(line.text)) paragraphs.push(line.text);
      else if (paragraphs.length) paragraphs[paragraphs.length - 1] += ` ${line.text}`;
      else paragraphs.push(line.text);
    }
    const pages = Array.from(new Set([current.markerPage, ...current.lines.map((line) => line.page)])).sort((a, b) => a - b);
    const optionIndex = paragraphs.findIndex((line) => /^[A-H][.、)](?:\s+|$)/.test(line));
    if (optionIndex < 0) {
      skipped.push({ sourceNumber: current.sourceNumber, pages, reason: "未识别到文本选项，可能使用了图片" });
      return;
    }
    const stem = paragraphs.slice(0, optionIndex).join(" ").trim();
    const options = paragraphs.slice(optionIndex);
    const labels = options.map((line) => line.match(/^([A-H])[.、)](?:\s+|$)/)?.[1]).filter((label): label is string => Boolean(label));
    const expected = labels.length ? Array.from({ length: labels[labels.length - 1].charCodeAt(0) - 64 }, (_, index) => String.fromCharCode(65 + index)) : [];
    const emptyOptions = options.filter((line) => line.replace(/^[A-H][.、)]\s*/, "").trim().length < 3);
    const validLabels = labels.length >= 3 && new Set(labels).size === labels.length && labels.join("") === expected.join("");
    if (!stem || !validLabels || emptyOptions.length) {
      const reason = emptyOptions.length ? "选项内容无法从 PDF 文本层提取，可能是图片或截图" : "选项标签缺失、重复或顺序异常";
      skipped.push({ sourceNumber: current.sourceNumber, pages, reason });
      return;
    }
    questions.push({ sourceNumber: current.sourceNumber, original: `${stem}\n\n${options.join("\n")}` });
  };
  for (const line of lines) {
    const marker = line.text.match(/^Question\s*#\s*(\d+)(?:\s+Topic\s+\d+)?/i);
    if (marker) {
      flush();
      current = { sourceNumber: Number.parseInt(marker[1], 10), markerPage: line.page, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  if (!questions.length && !skipped.length) throw new Error("PDF 中没有识别到 Question #N 格式的题目");
  return { questions, skipped };
}

export async function extractQuestions(pdfPath: string, startQuestion?: number, limit?: number) {
  const extracted = await extractPdfLines(pdfPath, startQuestion, limit);
  return { ...parseQuestionLines(extracted.lines), pagesScanned: extracted.pagesScanned };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}

async function listAllQuestions(baseUrl: string) {
  const records: SavedQuestion[] = [];
  let offset = 0;
  while (true) {
    const payload = await requestJson<{ questions: SavedQuestion[]; total: number }>(`${baseUrl}/api/questions?limit=50&offset=${offset}`);
    records.push(...payload.questions);
    offset += payload.questions.length;
    if (!payload.questions.length || records.length >= payload.total) return records;
  }
}

async function saveRecord(baseUrl: string, record: SavedQuestion) {
  await requestJson(`${baseUrl}/api/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
}

function comparableAnalysis(analysis: Analysis) {
  return JSON.stringify({
    ...analysis,
    knowledge: analysis.knowledge.map(({ title, body, cue }) => ({ title, body, cue })),
  });
}

async function consolidateExisting(baseUrl: string, records: SavedQuestion[]) {
  let changed = 0;
  for (const record of records) {
    const analysis = canonicalizeAnalysis(record.analysis);
    if (comparableAnalysis(analysis) === comparableAnalysis(record.analysis)) continue;
    await saveRecord(baseUrl, { ...record, title: analysis.title, analysis });
    changed += 1;
  }
  return changed;
}

const wait = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function importPdf(options: ImportOptions) {
  const extraction = await extractQuestions(options.pdfPath, options.startQuestion, options.limit);
  const questions = extraction.questions;
  console.log(`扫描完成：${extraction.pagesScanned} 页，可导入 ${questions.length} 道，跳过 ${extraction.skipped.length} 道。`);
  if (questions.length) console.log(`已识别：${questions.map((item) => `#${item.sourceNumber}`).join("、")}`);
  for (const item of extraction.skipped) console.warn(`跳过 Question #${item.sourceNumber}（PDF 第 ${item.pages.join("、")} 页）：${item.reason}`);
  if (options.dryRun) {
    for (const item of questions) console.log(`\n[Question #${item.sourceNumber}]\n${item.original}`);
    console.log(`\nDRY RUN 完成：以上 ${questions.length} 道题结构有效；没有调用 DeepSeek，也没有写入数据库。`);
    return { parsed: questions.length, invalidSkipped: extraction.skipped.length, imported: 0, skipped: 0, failed: 0, consolidated: 0, aiConsolidation: null };
  }

  const existing = await listAllQuestions(options.baseUrl);
  const existingHashes = new Set(existing.map((record) => questionHash(record.original)));
  let imported = 0;
  let skipped = 0;
  const failures: Array<{ sourceNumber: number; message: string }> = [];
  for (const item of questions) {
    const hash = questionHash(item.original);
    if (existingHashes.has(hash)) {
      console.log(`跳过 Question #${item.sourceNumber}：题目已存在`);
      skipped += 1;
      continue;
    }
    try {
      console.log(`解析 Question #${item.sourceNumber}…`);
      const analyzed = await requestJson<{ analysis: Analysis; runId: string; analysisMeta?: AnalysisMeta }>(`${options.baseUrl}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: item.original }),
      });
      const analysis = canonicalizeAnalysis(analyzed.analysis);
      await saveRecord(options.baseUrl, {
        id: stableQuestionId(item.original),
        original: item.original,
        title: analysis.title,
        analysis,
        analysisRunId: analyzed.runId,
        analysisMeta: analyzed.analysisMeta,
        mastery: "unreviewed",
        familiarity: 0,
        createdAt: new Date().toISOString(),
      });
      existingHashes.add(hash);
      imported += 1;
      console.log(`已保存 Question #${item.sourceNumber}：${analysis.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      failures.push({ sourceNumber: item.sourceNumber, message });
      console.error(`Question #${item.sourceNumber} 失败：${message}`);
    }
    if (options.delayMs) await wait(options.delayMs);
  }
  const consolidated = options.consolidate ? await consolidateExisting(options.baseUrl, existing) : 0;
  let aiConsolidation: { tagGroups: number; knowledgeGroups: number; updatedQuestions: number; totalTokens: number } | null = null;
  if (options.aiConsolidate && (options.forceAiConsolidation || imported > 0 || consolidated > 0)) {
    const catalog = await requestJson<{ tags: unknown[]; knowledge: unknown[] }>(`${options.baseUrl}/api/taxonomy/consolidate`);
    if (catalog.tags.length > 320 || catalog.knowledge.length > 120) {
      console.log(`当前有 ${catalog.tags.length} 个标签、${catalog.knowledge.length} 个知识点，已跳过单次 AI 归并。`);
      console.log("请在导入结束后运行 npm run consolidate:taxonomy，脚本会分批处理并保存进度。");
    } else {
      console.log("执行 AI 标签与知识点归并…");
      aiConsolidation = await requestJson<{ tagGroups: number; knowledgeGroups: number; updatedQuestions: number; totalTokens: number }>(`${options.baseUrl}/api/taxonomy/consolidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      console.log(`AI 归并：标签组 ${aiConsolidation.tagGroups}，知识点组 ${aiConsolidation.knowledgeGroups}，更新题目 ${aiConsolidation.updatedQuestions}`);
    }
  }
  const summary = { parsed: questions.length, invalidSkipped: extraction.skipped.length, imported, skipped, failed: failures.length, consolidated, aiConsolidation, failures };
  console.log(`\n导入完成：新增 ${imported}，重复跳过 ${skipped}，格式跳过 ${extraction.skipped.length}，失败 ${failures.length}，规则归一化旧题 ${consolidated}`);
  if (failures.length) process.exitCode = 1;
  return summary;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  importPdf(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
