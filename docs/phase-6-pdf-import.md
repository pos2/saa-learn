# 阶段 6：PDF 题库批量导入与知识归一化

阶段 6 的目标是把 PDF 题库可靠地转换为现有题目数据，并在批量导入时控制分类和知识点数量。页面作答与判题顺延到阶段 7。

## 运行方式

先启动本地应用，再执行：

```bash
npm run import:pdf -- /absolute/path/questions.pdf
```

Codex 工作区已经包含 PDF 提取环境；在普通本地终端首次运行时，如提示缺少 `pdfplumber`，执行：

```bash
python3 -m pip install -r requirements-import.txt
```

建议先检查拆题结果，不调用 DeepSeek、不写数据库：

```bash
npm run import:pdf -- /absolute/path/questions.pdf --dry-run
```

可选参数：

- `--limit=10`：只处理前 10 道
- `--start=20`：从 PDF 中的 Question #20 开始
- `--delay=800`：每次解析之间等待 800 毫秒
- `--base-url=http://localhost:3000`：指定本地应用地址
- `--skip-consolidation`：跳过对已有题目分类的归一化
- `--skip-ai-consolidation`：保留本地规则归一化，但跳过最终 AI 全局去重
- `--force-ai-consolidation`：即使本次没有新增题目，也强制运行一次 AI 全局去重

题库规模较大时，最终 AI 去重会自动从导入流程中跳过。导入结束后独立运行：

```bash
npm run consolidate:taxonomy
```

该命令按标签类型和 AWS 服务语义分批调用 DeepSeek，并在 `.wrangler/taxonomy-consolidation-state.json` 保存进度。命令中断后直接再次运行即可从未完成批次继续；`--dry-run` 只显示批次数量，`--restart` 会放弃旧进度并按当前数据库重新生成批次。

完成全量归并后，可用 `npm run consolidate:taxonomy -- --candidate-pass` 低成本复核名称高度相似的知识点。候选轮次会去除 AWS/Amazon 前缀及“部署、策略、规则”等泛化词来组队，但仍由 AI 判断语义，并经过相同的严格校验后才合并。

## 导入流程

1. 本地读取 PDF 文本并识别 `Question #N`、题干和 A-H 选项。
2. 对规范化后的原题计算 SHA-256，已存在的题目自动跳过，因此中断后可直接重跑。
3. 仅把完整题目发送到现有 `/api/analyze`，由 DeepSeek 生成答案和中文解析。
4. 本地将服务、题型、关键词和常见知识点映射到规范名称。
5. 保存题目、选项解析、知识点、标签和本次模型调用记录。
6. 重新保存需要规则归一化的旧题，并清理失去关联的旧标签和知识点。
7. 小题库可在导入结束后直接调用 DeepSeek 去重；大题库使用 `consolidate:taxonomy` 分批审阅规则未覆盖的同义标签和知识点。本地严格校验每批合并方案后才写入数据库。

## 边界

- PDF 拆题、原题去重、规则归一化和保存不调用模型。
- DeepSeek 只用于逐题答案/中文解析，以及整批结束后的全局标签和知识点语义去重。
- AI 只能提出合并方案：规范名称必须来自现有项目，不能引用不存在的标签，也不能把一个项目放入多个合并组；实际数据库修改由本地代码执行。
- 当前解析器针对带有 `Question #N` 和字母选项的文本型 PDF；扫描图片 PDF 需要后续增加 OCR。
- 带有图片、截图或无法从 PDF 文本层提取的选项会记录题号和页码后自动跳过，不会中断整批导入，也不会调用 DeepSeek。
- `--start` 和 `--limit` 会在 PDF 扫描阶段生效；小批量 dry-run 不再预先扫描整份文档。
- 题型使用受控词表；常用 AWS 服务和知识点通过可维护的别名表归并。
