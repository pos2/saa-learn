import { listQuestions, saveQuestion } from "../../../db/questions";
import { getSetting } from "../../../db/settings";
import type { SavedQuestion } from "../../../lib/domain";
import { parseAnalysis } from "../../../lib/analysis-schema";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get("search") ?? "";
    const requestedMastery = params.get("mastery") ?? "all";
    const mastery = ["all", "unreviewed", "learning", "mastered"].includes(requestedMastery)
      ? requestedMastery as "all" | SavedQuestion["mastery"] : "all";
    const limit = Number.parseInt(params.get("limit") ?? "20", 10);
    const offset = Number.parseInt(params.get("offset") ?? "0", 10);
    return Response.json(await listQuestions({ search, mastery, limit, offset }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取题库失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const question = (await request.json()) as SavedQuestion;
    if (!question.id || !question.original?.trim() || !question.analysis) {
      return Response.json({ error: "题目内容或解析不完整" }, { status: 400 });
    }
    try {
      question.analysis = parseAnalysis(question.analysis, question.original);
      question.title = question.analysis.title;
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "解析结果格式不正确" }, { status: 400 });
    }
    const systemPrompt = await getSetting("system_prompt");
    return Response.json({ question: await saveQuestion(question, systemPrompt) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存题目失败" }, { status: 500 });
  }
}
