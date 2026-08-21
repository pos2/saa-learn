# SAA Learn

一个把 AWS SAA 题目转化为可检索学习资料的交互原型。

当前版本包含完整学习闭环：输入题目、生成解析、确认保存、通过高级检索重新打开，并可从独立知识点页面查看讲解和关联题目。题目、选项、标签、知识点、解析记录和系统 Prompt 已保存到本地 D1 / SQLite 数据库。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## 当前功能

- 示例题一键填入和题目输入
- 结构化解析预览
- 原始题目与解析同时保存
- 数据库分页与“加载更多”
- 多关键词、AWS 中英文别名和字段权重排序的高级检索
- 搜索结果关键词高亮
- 独立知识点列表、详情和关联题目跳转
- PDF 题库批量导入、重复检测、规则归一化与批末 AI 语义去重
- 题目详情和删除
- 可自定义的系统 Prompt
- AI 候选分类策略
- 首次启动时自动迁移阶段 1 的浏览器数据
- DeepSeek V4 Flash 中文结构化解析
- 未复习、学习中、已掌握三档掌握状态

## 本地 DeepSeek 配置

复制 `.env.example` 为 `.env.local`，填入 `DEEPSEEK_API_KEY` 后重启本地服务。模型固定为 `deepseek-v4-flash`；API Key 只在服务端读取，不会发送到浏览器或写入数据库。

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run import:pdf -- /absolute/path/questions.pdf --dry-run`: 检查 PDF 拆题结果
- `npm run import:pdf -- /absolute/path/questions.pdf`: 调用现有解析接口并保存题目
- `npm run consolidate:taxonomy -- --dry-run`: 检查标签与知识点分批归并计划，不调用模型
- `npm run consolidate:taxonomy`: 分批调用 DeepSeek 合并同义标签与知识点，可从中断处继续
- `npm run consolidate:taxonomy -- --candidate-pass`: 复核名称高度相似的知识点候选

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
