import { getSetting, setSetting } from "../../../../db/settings";

export async function GET() {
  try {
    return Response.json({ value: await getSetting("system_prompt") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取 Prompt 失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { value } = (await request.json()) as { value?: string };
    if (!value?.trim()) return Response.json({ error: "系统 Prompt 不能为空" }, { status: 400 });
    await setSetting("system_prompt", value);
    return Response.json({ value });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存 Prompt 失败" }, { status: 500 });
  }
}
