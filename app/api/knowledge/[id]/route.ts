import { getKnowledgePoint } from "../../../../db/knowledge";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const knowledgePoint = await getKnowledgePoint(id);
    return knowledgePoint ? Response.json({ knowledgePoint }) : Response.json({ error: "知识点不存在" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取知识点失败" }, { status: 500 });
  }
}
