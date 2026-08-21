import { listKnowledgePoints } from "../../../db/knowledge";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get("search") ?? "";
    const limit = Number.parseInt(params.get("limit") ?? "20", 10);
    const offset = Number.parseInt(params.get("offset") ?? "0", 10);
    return Response.json(await listKnowledgePoints({ search, limit, offset }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取知识点失败" }, { status: 500 });
  }
}
