import { getWeightedRandomQuestion } from "../../../../db/questions";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const excludeIds = params.getAll("exclude");
    const familiarityParam = params.get("familiarity");
    const familiarity = familiarityParam === null ? undefined : Number.parseInt(familiarityParam, 10);
    if (familiarity !== undefined && (!Number.isInteger(familiarity) || familiarity < 0 || familiarity > 5)) {
      return Response.json({ error: "熟悉度必须是 0 到 5 的整数" }, { status: 400 });
    }
    const question = await getWeightedRandomQuestion(excludeIds, familiarity);
    return question ? Response.json({ question }) : Response.json({ error: "题库中没有可供抽取的题目" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "随机选题失败" }, { status: 500 });
  }
}
