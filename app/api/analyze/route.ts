import { createAnalysisRun } from "../../../db/analysis-runs";
import { getSetting } from "../../../db/settings";
import { ANALYSIS_JSON_INSTRUCTION, parseAnalysis } from "../../../lib/analysis-schema";
import { getDeepSeekConfig } from "../../../lib/deepseek-config";
import { DEFAULT_SYSTEM_PROMPT } from "../../../lib/domain";

type DeepSeekResponse = {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

const RETRYABLE_STATUS = new Set([429, 500, 503]);

class DeepSeekHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function POST(request: Request) {
  const config = getDeepSeekConfig();
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  let rawResponse: unknown = null;
  let attemptCount = 0;
  const startedAt = Date.now();
  try {
    systemPrompt = await getSetting("system_prompt");
    const { question } = (await request.json()) as { question?: string };
    if (!question?.trim()) return Response.json({ error: "题目不能为空" }, { status: 400 });
    if (question.length > 30_000) return Response.json({ error: "题目过长，请控制在 30,000 字以内" }, { status: 400 });
    if (!config.apiKey) {
      return Response.json({ error: "尚未配置 DEEPSEEK_API_KEY，请先在 .env.local 中填写后重启本地服务" }, { status: 503 });
    }

    let payload: DeepSeekResponse | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attemptCount = attempt;
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: `${systemPrompt}\n\n${ANALYSIS_JSON_INSTRUCTION}` },
              { role: "user", content: `请分析以下 AWS SAA 题目。保留英文原题，仅将解析输出为中文：\n\n${question}` },
            ],
            thinking: { type: config.thinking },
            reasoning_effort: "high",
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 8_000,
            stream: false,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        rawResponse = await response.json();
        payload = rawResponse as DeepSeekResponse;
        if (!response.ok) throw new DeepSeekHttpError(payload.error?.message ?? `DeepSeek 请求失败（${response.status}）`, response.status);
        break;
      } catch (error) {
        const retryable = error instanceof DeepSeekHttpError
          ? RETRYABLE_STATUS.has(error.status)
          : error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
        if (!retryable || attempt === 2) throw error;
        await wait(700 * attempt);
      }
    }
    if (!payload) throw new Error("DeepSeek 没有返回响应");
    const choice = payload.choices?.[0];
    if (!choice?.message?.content) throw new Error("DeepSeek 没有返回解析内容");
    if (choice.finish_reason === "length") throw new Error("解析内容超过输出上限，请缩短题目后重试");

    const analysis = parseAnalysis(JSON.parse(choice.message.content), question);
    const usage = payload.usage;
    const analysisMeta = {
      model: config.model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      attemptCount,
      latencyMs: Date.now() - startedAt,
    };
    const runId = await createAnalysisRun({ provider: "deepseek", systemPrompt, rawResponse, status: "succeeded", ...analysisMeta });
    return Response.json({ analysis, runId, analysisMeta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析题目失败";
    try {
      await createAnalysisRun({ provider: "deepseek", model: config.model, systemPrompt, rawResponse: rawResponse ?? { error: message }, status: "failed", attemptCount: Math.max(attemptCount, 1), latencyMs: Date.now() - startedAt });
    } catch { /* Preserve the original model error when logging also fails. */ }
    return Response.json({ error: message }, { status: 502 });
  }
}
