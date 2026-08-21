import type { Analysis } from "./domain";
import { canonicalizeAnalysis, CANONICAL_TOPIC_NAMES } from "./taxonomy";

const uniqueStrings = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`模型返回的 ${field} 格式不正确`);
  }
  return Array.from(new Set(value.map((item) => item.trim())));
};

function extractOptionLabels(original: string) {
  return Array.from(original.matchAll(/^\s*([A-H])(?:[.、):]|\s+-)\s+/gim), (match) => match[1].toUpperCase());
}

function extractAnswerLabels(answer: string) {
  return Array.from(answer.toUpperCase().matchAll(/(?:^|[\s,，、/&+])([A-H])(?=$|[\s,，、/&+.(（])/g), (match) => match[1]);
}

export function parseAnalysis(value: unknown, originalQuestion?: string): Analysis {
  if (!value || typeof value !== "object") throw new Error("模型没有返回有效的 JSON 对象");
  const input = value as Record<string, unknown>;
  if (typeof input.answer !== "string" || !input.answer.trim()) throw new Error("模型没有返回答案");
  if (typeof input.summary !== "string" || !input.summary.trim()) throw new Error("模型没有返回解题结论");
  if (!/[\u3400-\u9fff]/.test(input.summary)) throw new Error("模型解析没有使用中文，请重试");
  const fallbackTitle = input.summary.trim().split(/[。！？]/)[0];
  const title = (typeof input.title === "string" && input.title.trim() ? input.title.trim() : fallbackTitle).slice(0, 64);
  if (!/[\u3400-\u9fff]/.test(title)) throw new Error("模型没有返回中文语义标题");
  if (!Array.isArray(input.optionNotes) || !input.optionNotes.length) throw new Error("模型没有逐项解释选项");
  if (!Array.isArray(input.knowledge) || !input.knowledge.length) throw new Error("模型没有返回知识点");

  const optionNotes = input.optionNotes.map((item) => {
    if (!item || typeof item !== "object") throw new Error("选项解析格式不正确");
    const option = item as Record<string, unknown>;
    if (typeof option.label !== "string" || typeof option.correct !== "boolean" || typeof option.text !== "string") {
      throw new Error("选项解析缺少 label、correct 或 text");
    }
    if (!/[\u3400-\u9fff]/.test(option.text)) throw new Error("选项解释必须使用中文");
    return { label: option.label.trim().toUpperCase(), correct: option.correct, text: option.text.trim() };
  });

  const returnedLabels = optionNotes.map((option) => option.label);
  if (new Set(returnedLabels).size !== returnedLabels.length) throw new Error("模型返回了重复的选项解析");
  const correctLabels = optionNotes.filter((option) => option.correct).map((option) => option.label).sort();
  const answerLabels = extractAnswerLabels(input.answer.trim()).sort();
  if (!correctLabels.length || !answerLabels.length || correctLabels.join(",") !== answerLabels.join(",")) {
    throw new Error("答案与逐项解析中的正确选项不一致");
  }
  if (originalQuestion) {
    const sourceLabels = extractOptionLabels(originalQuestion);
    if (sourceLabels.length >= 2) {
      const expected = Array.from(new Set(sourceLabels)).sort();
      const actual = Array.from(new Set(returnedLabels)).sort();
      if (expected.join(",") !== actual.join(",")) throw new Error(`解析必须完整覆盖原题选项：${expected.join("、")}`);
    }
  }

  const knowledge = input.knowledge.map((item) => {
    if (!item || typeof item !== "object") throw new Error("知识点格式不正确");
    const point = item as Record<string, unknown>;
    if (typeof point.title !== "string" || typeof point.body !== "string" || typeof point.cue !== "string") {
      throw new Error("知识点缺少 title、body 或 cue");
    }
    if (!/[\u3400-\u9fff]/.test(`${point.body}${point.cue}`)) throw new Error("知识点讲解必须使用中文");
    return { title: point.title.trim(), body: point.body.trim(), cue: point.cue.trim() };
  });

  return canonicalizeAnalysis({
    title,
    answer: input.answer.trim(),
    summary: input.summary.trim(),
    services: uniqueStrings(input.services, "services"),
    topics: uniqueStrings(input.topics, "topics"),
    keywords: uniqueStrings(input.keywords, "keywords"),
    optionNotes,
    knowledge,
  });
}

export const ANALYSIS_JSON_INSTRUCTION = `只输出一个 JSON 对象，不要使用 Markdown 代码块。JSON 必须严格使用以下结构：
{
  "title": "简体中文语义标题，概括场景与核心问题，不超过 30 个汉字，例如：通过 S3 网关端点降低 NAT 数据传输成本",
  "answer": "正确选项，例如 B 或 A, C",
  "summary": "简体中文的解题结论与核心理由",
  "services": ["AWS 服务的官方英文名称"],
  "topics": ["从指定题型词表中选择"],
  "keywords": ["用于检索的中文或 AWS 英文关键词"],
  "optionNotes": [
    { "label": "A", "correct": false, "text": "简体中文逐项解释" }
  ],
  "knowledge": [
    { "title": "知识点名称，可保留 AWS 英文术语", "body": "简体中文详细讲解", "cue": "简体中文考试判断线索" }
  ]
}
题目原文无论是英文还是中文，所有解释性文字都必须使用简体中文。标题必须是“场景 + 核心问题”的中文概括，不能截取或翻译题干，不能包含“这道题”“以下哪项”等空泛表述。必须解释题目中的每一个选项。
topics 只能从以下词表中选择，不要创造同义名称：${CANONICAL_TOPIC_NAMES.join("、")}。
services 使用 AWS 官方英文名称；知识点标题优先使用 AWS 官方功能名，避免中英文各创建一份。`;
