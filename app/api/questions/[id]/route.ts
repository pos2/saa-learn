import { deleteQuestion, getQuestion, updateFamiliarity, updateMastery } from "../../../../db/questions";
import type { SavedQuestion } from "../../../../lib/domain";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const question = await getQuestion(id);
    return question ? Response.json({ question }) : Response.json({ error: "题目不存在" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取题目失败" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await deleteQuestion(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除题目失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { mastery, familiarity } = (await request.json()) as { mastery?: SavedQuestion["mastery"]; familiarity?: number };
    if (mastery !== undefined) {
      if (!["unreviewed", "learning", "mastered"].includes(mastery)) return Response.json({ error: "无效的掌握状态" }, { status: 400 });
      const update = await updateMastery(id, mastery);
      return update ? Response.json({ update }) : Response.json({ error: "题目不存在" }, { status: 404 });
    }
    if (typeof familiarity !== "number" || !Number.isInteger(familiarity) || familiarity < 0 || familiarity > 5) {
      return Response.json({ error: "熟悉度必须是 0 到 5 的整数" }, { status: 400 });
    }
    const update = await updateFamiliarity(id, familiarity);
    return update ? Response.json({ update }) : Response.json({ error: "题目不存在" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新掌握状态失败" }, { status: 500 });
  }
}
