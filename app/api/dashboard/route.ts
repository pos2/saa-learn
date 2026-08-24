import { getFamiliarityStats } from "../../../db/questions";

export async function GET() {
  try {
    return Response.json(await getFamiliarityStats());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取学习统计失败" }, { status: 500 });
  }
}
