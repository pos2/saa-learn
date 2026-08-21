# 阶段 2：本地数据库

## 数据关系

- `questions`：原题、答案摘要、状态和模型信息。
- `question_options`：选项内容、逐项解释和正确性。
- `knowledge_points`：可复用的候选知识点。
- `question_knowledge_points`：题目和知识点的多对多关系。
- `tags`：服务、候选题型和关键词。
- `question_tags`：题目和标签的多对多关系。
- `ai_analysis_runs`：模型、Prompt 快照、原始结构化响应和运行状态。
- `app_settings`：自定义系统 Prompt 等本地设置。

## 本地行为

应用 API 第一次访问数据库时会以幂等方式建立表和索引，正式 SQL 迁移同时保存在 `drizzle/`。删除题目会级联删除题目专属关联，但保留可复用的标签与知识点。

阶段 1 的 `localStorage` 题目和 Prompt 会在首次启动阶段 2 时写入数据库，全部成功后才清理旧数据。

## DeepSeek 决策

模型使用 `deepseek-v4-flash`，基础地址为 `https://api.deepseek.com`。数据库已预留模型名、Prompt 版本、Prompt 快照与原始响应字段；API Key 不进入浏览器或数据库。
