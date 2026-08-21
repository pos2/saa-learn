import { getWeightedRandomQuestion } from "../../../../db/questions";

export async function GET(request: Request) {
  try {
    const excludeIds = new URL(request.url).searchParams.getAll("exclude");
    const question = await getWeightedRandomQuestion(excludeIds);
    return question ? Response.json({ question }) : Response.json({ error: "题库中没有可供抽取的题目" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "随机选题失败" }, { status: 500 });
  }
}
