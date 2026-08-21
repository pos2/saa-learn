import type { Analysis } from "../lib/domain";
import { ensureDatabase, getD1 } from "./init";

export async function createAnalysisRun(input: {
  provider: string;
  model: string;
  systemPrompt: string;
  rawResponse: unknown;
  status: "succeeded" | "failed";
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  attemptCount?: number;
  latencyMs?: number;
}) {
  await ensureDatabase();
  const id = crypto.randomUUID();
  await getD1().prepare(`INSERT INTO ai_analysis_runs
    (id, question_id, provider, model, system_prompt_snapshot, raw_response, status,
      prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, attempt_count, latency_ms, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.provider, input.model, input.systemPrompt, JSON.stringify(input.rawResponse), input.status,
      input.promptTokens ?? 0, input.completionTokens ?? 0, input.reasoningTokens ?? 0,
      input.totalTokens ?? 0, input.attemptCount ?? 1, input.latencyMs ?? 0, new Date().toISOString()).run();
  return id;
}

export async function attachAnalysisRun(runId: string, questionId: string, analysis: Analysis) {
  await ensureDatabase();
  await getD1().prepare(`UPDATE ai_analysis_runs SET question_id = ?, raw_response = ?, status = 'succeeded' WHERE id = ?`)
    .bind(questionId, JSON.stringify(analysis), runId).run();
}
