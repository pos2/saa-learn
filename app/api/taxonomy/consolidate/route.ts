import { createAnalysisRun } from "../../../../db/analysis-runs";
import { applyTaxonomyPlan, getTaxonomyCatalog } from "../../../../db/taxonomy";
import { getDeepSeekConfig } from "../../../../lib/deepseek-config";
import { parseTaxonomyMergePlan, sanitizeTaxonomyMergePlan, type TaxonomyCatalog } from "../../../../lib/taxonomy-ai";

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
};

const SYSTEM_PROMPT = `你是 AWS SAA 学习题库的信息架构师。请审阅现有标签和知识点，只合并语义完全相同、仅名称不同的项目。
不得合并相关但不同的概念，不得把 AWS 服务与该服务的具体功能合并。例如 S3 Transfer Acceleration 与 S3 Multipart Upload 不能合并。
规范名称必须从 members 中选择：服务优先 AWS 官方英文名称，题型优先现有简体中文名称，知识点优先准确简洁的 AWS 官方功能名。
知识点合并时，综合所有成员内容，输出一份简体中文 body 和 cue。没有可合并项目时返回空数组。
只输出 JSON：{"tagGroups":[{"kind":"service|topic|keyword","canonicalName":"现有名称","members":["现有名称1","现有名称2"]}],"knowledgeGroups":[{"canonicalTitle":"现有标题","members":["现有标题1","现有标题2"],"body":"合并后的中文讲解","cue":"合并后的中文考试线索"}]}`;

function localOnly(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function GET(request: Request) {
  if (!localOnly(request)) return Response.json({ error: "知识归并接口仅允许在本地使用" }, { status: 403 });
  try {
    return Response.json(await getTaxonomyCatalog());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取分类目录失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!localOnly(request)) return Response.json({ error: "知识归并接口仅允许在本地使用" }, { status: 403 });
  const config = getDeepSeekConfig();
  const startedAt = Date.now();
  let rawResponse: unknown = null;
  try {
    if (!config.apiKey) return Response.json({ error: "尚未配置 DEEPSEEK_API_KEY" }, { status: 503 });
    const requested = await request.json().catch(() => ({})) as {
      tags?: Array<{ kind: "service" | "topic" | "keyword"; name: string }>;
      knowledgeTitles?: string[];
    };
    const fullCatalog = await getTaxonomyCatalog();
    const requestedTags = new Set((requested.tags ?? []).map((item) => `${item.kind}:${item.name}`));
    const requestedKnowledge = new Set(requested.knowledgeTitles ?? []);
    const hasSubset = requestedTags.size > 0 || requestedKnowledge.size > 0;
    const catalog: TaxonomyCatalog = hasSubset ? {
      tags: fullCatalog.tags.filter((item) => requestedTags.has(`${item.kind}:${item.name}`)),
      knowledge: fullCatalog.knowledge.filter((item) => requestedKnowledge.has(item.title)),
    } : fullCatalog;
    if (catalog.tags.length > 320 || catalog.knowledge.length > 120) {
      return Response.json({ error: "本批次超过 AI 归并上限：标签最多 320 个，知识点最多 120 个" }, { status: 413 });
    }
    if (catalog.tags.length + catalog.knowledge.length < 2) {
      return Response.json({ tagGroups: 0, knowledgeGroups: 0, updatedQuestions: 0, statements: 0, totalTokens: 0 });
    }
    const compactCatalog = {
      tags: catalog.tags,
      knowledge: catalog.knowledge.map((item) => ({ ...item, body: item.body.slice(0, 240), cue: item.cue.slice(0, 160) })),
    };
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(compactCatalog) }],
        // Taxonomy batches need a compact JSON decision, not a long reasoning trace.
        // With thinking enabled, v4-flash can spend the entire completion budget
        // on reasoning and return an empty content field.
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 8_000,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    rawResponse = await response.json();
    const payload = rawResponse as DeepSeekResponse;
    if (!response.ok) throw new Error(payload.error?.message ?? `DeepSeek 去重请求失败（${response.status}）`);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      const finishReason = payload.choices?.[0] && "finish_reason" in payload.choices[0]
        ? String((payload.choices[0] as { finish_reason?: unknown }).finish_reason ?? "unknown")
        : "unknown";
      throw new Error(`DeepSeek 没有返回知识归并方案（finish_reason=${finishReason}）`);
    }
    const plan = parseTaxonomyMergePlan(sanitizeTaxonomyMergePlan(JSON.parse(content), catalog), catalog);
    const applied = await applyTaxonomyPlan(plan);
    const usage = payload.usage;
    await createAnalysisRun({
      provider: "deepseek-taxonomy", model: config.model, systemPrompt: SYSTEM_PROMPT, rawResponse,
      status: "succeeded", promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens, totalTokens: usage?.total_tokens,
      latencyMs: Date.now() - startedAt,
    });
    return Response.json({
      tagGroups: plan.tagGroups.length,
      knowledgeGroups: plan.knowledgeGroups.length,
      updatedQuestions: 0,
      statements: applied.statements,
      totalTokens: usage?.total_tokens ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 知识归并失败";
    try {
      await createAnalysisRun({ provider: "deepseek-taxonomy", model: config.model, systemPrompt: SYSTEM_PROMPT, rawResponse: rawResponse ?? { error: message }, status: "failed", latencyMs: Date.now() - startedAt });
    } catch { /* Keep the original consolidation error. */ }
    return Response.json({ error: message }, { status: 502 });
  }
}
