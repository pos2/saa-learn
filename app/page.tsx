"use client";

import { useEffect, useMemo, useState } from "react";

type View = "input" | "analysis" | "library" | "detail";
type Analysis = {
  answer: string;
  summary: string;
  services: string[];
  topics: string[];
  keywords: string[];
  optionNotes: { label: string; correct: boolean; text: string }[];
  knowledge: { title: string; body: string; cue: string }[];
};
type SavedQuestion = {
  id: string;
  original: string;
  title: string;
  analysis: Analysis;
  createdAt: string;
};

const STORAGE_KEY = "saa-learn-questions-v1";
const PROMPT_KEY = "saa-learn-system-prompt-v1";

const exampleQuestion = `一家公司在私有子网中运行 EC2 实例。这些实例需要访问 Amazon S3，要求流量不经过公共互联网，并尽可能降低成本。哪种解决方案最合适？\n\nA. 在公有子网中部署 NAT Gateway\nB. 创建 S3 Gateway VPC Endpoint\nC. 为实例分配弹性 IP\nD. 创建 Internet Gateway`;

const defaultPrompt = `你是一位严谨的 AWS Solutions Architect Associate 学习教练。请分析用户提供的题目：
1. 保留原始题目，不擅自改写条件；
2. 给出正确答案，并逐项解释每个选项；
3. 提取 AWS 服务、候选题型、关键词与相关知识点；
4. 说明解题线索、常见误区和适用场景；
5. 不确定时明确说明，不要编造 AWS 功能；
6. 返回符合应用约定 Schema 的结构化结果。`;

function buildPrototypeAnalysis(question: string): Analysis {
  const isEndpointQuestion = /S3/i.test(question) && /(私有子网|private subnet)/i.test(question);
  if (isEndpointQuestion) {
    return {
      answer: "B",
      summary: "题目同时强调不经过公共互联网与降低成本。S3 Gateway VPC Endpoint 能让 VPC 内资源通过 AWS 网络访问 S3，并且不需要 NAT Gateway。",
      services: ["Amazon VPC", "Amazon S3", "Amazon EC2"],
      topics: ["网络与内容分发", "安全架构", "成本优化"],
      keywords: ["私有子网", "Gateway Endpoint", "不经过公网"],
      optionNotes: [
        { label: "A", correct: false, text: "NAT Gateway 可以让私有子网访问公网服务，但会产生按小时和流量计费，且不满足最佳成本目标。" },
        { label: "B", correct: true, text: "Gateway VPC Endpoint 支持 S3，可通过路由表让流量留在 AWS 网络中，并避免 NAT Gateway 成本。" },
        { label: "C", correct: false, text: "私有子网实例不应依赖弹性 IP；弹性 IP 也不能单独提供到互联网的路由。" },
        { label: "D", correct: false, text: "Internet Gateway 需要公有 IP 和正确路由，无法直接让私有子网实例私密访问 S3。" },
      ],
      knowledge: [
        { title: "Gateway VPC Endpoint", body: "面向 Amazon S3 和 DynamoDB 的 VPC Endpoint 类型。它通过路由表工作，不需要在子网中创建弹性网络接口。", cue: "看到 S3 / DynamoDB + 私有访问 + 低成本时优先考虑" },
        { title: "NAT Gateway", body: "让私有子网资源发起到公网的出站连接，具备高可用托管能力，但存在小时费和数据处理费。", cue: "需要访问任意公网目标时考虑，不是访问 S3 的最低成本首选" },
        { title: "私有访问的判断顺序", body: "先识别目标服务是否支持 VPC Endpoint，再判断 Endpoint 类型，最后比较 NAT、专线等方案的成本和可用性。", cue: "服务支持范围 → 网络路径 → 成本约束" },
      ],
    };
  }

  return {
    answer: "待模型确认",
    summary: "原型已识别题目结构。正式接入模型后，这里将结合所有约束条件生成可核验的答案与推理。",
    services: Array.from(question.matchAll(/\b(S3|EC2|RDS|VPC|Lambda|DynamoDB|CloudFront|Route 53)\b/gi)).map((m) => m[0]).slice(0, 4).concat(["待确认"]).slice(0, 4),
    topics: ["AI 候选分类", "待用户确认"],
    keywords: question.split(/[，。\s]/).filter((item) => item.length > 3).slice(0, 3),
    optionNotes: [
      { label: "—", correct: false, text: "当前为页面原型，非示例题将等待后续模型接口给出可靠的逐项解析。" },
    ],
    knowledge: [
      { title: "待生成知识点", body: "正式 AI 服务会根据题目约束生成候选知识点，并尝试关联已有条目。", cue: "用户确认后再进入正式知识库" },
    ],
  };
}

function compactTitle(text: string) {
  return text.split("\n")[0].replace(/^[\s\d.、]+/, "").slice(0, 58) || "未命名题目";
}

export default function Home() {
  const [view, setView] = useState<View>("input");
  const [question, setQuestion] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saved, setSaved] = useState<SavedQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(defaultPrompt);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const storedPrompt = window.localStorage.getItem(PROMPT_KEY);
      if (stored) setSaved(JSON.parse(stored));
      if (storedPrompt) setSystemPrompt(storedPrompt);
    } catch { /* Prototype storage may be unavailable in private browsing. */ }
    setReady(true);
  }, []);

  const selected = saved.find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return saved;
    return saved.filter((item) => {
      const searchable = [item.original, item.title, item.analysis.summary, ...item.analysis.services, ...item.analysis.topics, ...item.analysis.keywords].join(" ").toLowerCase();
      return searchable.includes(term);
    });
  }, [saved, search]);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function analyzeQuestion() {
    if (!question.trim()) return;
    setIsAnalyzing(true);
    window.setTimeout(() => {
      setAnalysis(buildPrototypeAnalysis(question));
      setIsAnalyzing(false);
      navigate("analysis");
    }, 650);
  }

  function saveQuestion() {
    if (!analysis) return;
    const record: SavedQuestion = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
      original: question,
      title: compactTitle(question),
      analysis,
      createdAt: new Date().toISOString(),
    };
    const next = [record, ...saved];
    setSaved(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSelectedId(record.id);
    setToast("题目已保存到我的题库");
    window.setTimeout(() => setToast(""), 2400);
  }

  function removeQuestion(id: string) {
    const next = saved.filter((item) => item.id !== id);
    setSaved(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    navigate("library");
  }

  function openQuestion(id: string) {
    setSelectedId(id);
    navigate("detail");
  }

  function startAnother() {
    setQuestion("");
    setAnalysis(null);
    navigate("input");
  }

  function savePrompt() {
    window.localStorage.setItem(PROMPT_KEY, systemPrompt);
    setSettingsOpen(false);
    setToast("系统 Prompt 已保存");
    window.setTimeout(() => setToast(""), 2200);
  }

  const currentQuestion = view === "detail" ? selected?.original : question;
  const currentAnalysis = view === "detail" ? selected?.analysis : analysis;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand plain-button" onClick={() => navigate("input")} aria-label="SAA Learn 首页">
          <span className="brand-mark">S</span><span>SAA Learn</span>
        </button>
        <nav className="nav" aria-label="主导航">
          <button className={`nav-link ${view === "input" || view === "analysis" ? "active" : ""}`} onClick={() => navigate("input")}>题目解析</button>
          <button className={`nav-link ${view === "library" || view === "detail" ? "active" : ""}`} onClick={() => navigate("library")}>我的题库 <span className="count-badge">{ready ? saved.length : 0}</span></button>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开系统 Prompt 设置">⚙</button>
        </nav>
      </header>

      {view === "input" && (
        <section className="workspace input-view">
          <div className="intro-row">
            <div>
              <p className="eyebrow">AI 学习工作台</p>
              <h1>从一道题，补齐一片知识。</h1>
              <p className="intro-copy">粘贴 SAA 题目，获得选项解析、关联知识点和考试判断线索。分类不必预先定义，AI 会先生成候选项。</p>
            </div>
            <div className="progress-chip"><span>已收录</span><strong>{saved.length}</strong><span>道题</span></div>
          </div>
          <div className="input-card">
            <div className="card-heading">
              <div><span className="step-number">01</span><h2>输入题目</h2></div>
              <button className="text-button" type="button" onClick={() => setQuestion(exampleQuestion)}>填入示例</button>
            </div>
            <label className="sr-only" htmlFor="question">题目正文与选项</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="在这里粘贴题干和选项…" />
            <div className="input-footer">
              <span>{question.length} 字 · 内容只在点击保存后进入题库</span>
              <button className="primary-button" type="button" disabled={!question.trim() || isAnalyzing} onClick={analyzeQuestion}>
                {isAnalyzing ? "正在解析…" : "开始解析"} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div className="trust-row"><span>✦ 解析后由你确认</span><span>⌘ 支持单选与多选题</span><span>◉ 自动生成候选分类</span></div>
        </section>
      )}

      {(view === "analysis" || view === "detail") && currentAnalysis && currentQuestion && (
        <section className="workspace result-view">
          <div className="result-topline">
            <button className="back-button" onClick={() => navigate(view === "detail" ? "library" : "input")}>← {view === "detail" ? "返回题库" : "修改题目"}</button>
            <span className="prototype-note">{view === "detail" ? "已保存记录" : "原型模拟解析 · 保存前请确认"}</span>
          </div>
          <div className="result-hero">
            <div><p className="eyebrow">{view === "detail" ? "题目详情" : "解析完成"}</p><h1>{view === "detail" ? selected?.title : "答案不只是一个选项。"}</h1></div>
            {view === "analysis" && <div className="action-group"><button className="secondary-button" onClick={startAnother}>暂不保存</button><button className="primary-button" onClick={saveQuestion}>保存到题库 <span>✓</span></button></div>}
          </div>

          <div className="result-grid">
            <article className="question-panel panel">
              <div className="panel-label"><span>原始题目</span><span>RAW</span></div>
              <pre>{currentQuestion}</pre>
            </article>
            <article className="answer-panel panel">
              <div className="answer-orb"><span>建议答案</span><strong>{currentAnalysis.answer}</strong></div>
              <div><h2>解题结论</h2><p>{currentAnalysis.summary}</p></div>
            </article>
          </div>

          <div className="tag-section">
            <div><span className="section-caption">涉及服务</span><div className="tag-list">{currentAnalysis.services.map((tag) => <span className="tag service" key={tag}>{tag}</span>)}</div></div>
            <div><span className="section-caption">AI 候选题型</span><div className="tag-list">{currentAnalysis.topics.map((tag) => <span className="tag" key={tag}>{tag} <small>候选</small></span>)}</div></div>
          </div>

          <section className="content-section">
            <div className="section-title"><span className="step-number">02</span><div><h2>逐项拆解</h2><p>先看每个选项在什么条件下成立。</p></div></div>
            <div className="option-list">{currentAnalysis.optionNotes.map((option) => (
              <article className={`option-row ${option.correct ? "correct" : ""}`} key={option.label}>
                <span className="option-letter">{option.label}</span><div><strong>{option.correct ? "正确选项" : "不推荐"}</strong><p>{option.text}</p></div><span className="verdict">{option.correct ? "✓" : "×"}</span>
              </article>
            ))}</div>
          </section>

          <section className="content-section knowledge-section">
            <div className="section-title"><span className="step-number">03</span><div><h2>关联知识点</h2><p>知识点会成为以后检索和归类的入口。</p></div></div>
            <div className="knowledge-grid">{currentAnalysis.knowledge.map((item, index) => (
              <article className="knowledge-card" key={item.title}><span className="knowledge-index">0{index + 1}</span><h3>{item.title}</h3><p>{item.body}</p><div className="exam-cue"><span>考试线索</span>{item.cue}</div></article>
            ))}</div>
          </section>

          <section className="keyword-bar"><span>检索关键词</span>{currentAnalysis.keywords.map((word) => <button key={word} onClick={() => { setSearch(word); navigate("library"); }}>#{word}</button>)}</section>
          {view === "detail" && <div className="detail-actions"><button className="danger-button" onClick={() => selected && removeQuestion(selected.id)}>删除这道题</button><button className="primary-button" onClick={startAnother}>解析新题目 →</button></div>}
          {view === "analysis" && <div className="sticky-save"><span>确认答案和候选分类后再保存</span><button className="primary-button" onClick={saveQuestion}>保存并查看题库 ✓</button></div>}
        </section>
      )}

      {view === "library" && (
        <section className="workspace library-view" id="library">
          <div className="library-header"><div><p className="eyebrow">PERSONAL QUESTION BANK</p><h1>我的题库</h1><p className="intro-copy">从题目原文、知识点、服务和候选分类中检索。</p></div><button className="primary-button" onClick={startAnother}>＋ 添加题目</button></div>
          <div className="search-box"><span>⌕</span><label className="sr-only" htmlFor="search">搜索题库</label><input id="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 S3、私有子网、成本优化…" />{search && <button onClick={() => setSearch("")} aria-label="清空搜索">×</button>}</div>
          <div className="library-meta"><span>{filtered.length} 道题目</span><span>本原型保存在当前浏览器</span></div>
          {filtered.length > 0 ? <div className="question-list">{filtered.map((item) => (
            <button className="question-item" onClick={() => openQuestion(item.id)} key={item.id}>
              <div className="question-number">{item.analysis.answer}</div>
              <div className="question-main"><div className="question-item-top"><span>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span><span>{item.analysis.services[0]}</span></div><h2>{item.title}</h2><p>{item.analysis.summary}</p><div className="mini-tags">{item.analysis.topics.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div></div>
              <span className="row-arrow">→</span>
            </button>
          ))}</div> : <div className="empty-state"><span className="empty-orb">◎</span><h2>{saved.length ? "没有匹配的题目" : "你的题库还是空的"}</h2><p>{saved.length ? "换一个关键词，或清空搜索条件。" : "从一道真实遇到的题开始，知识体系会自然长出来。"}</p><button className="primary-button" onClick={saved.length ? () => setSearch("") : startAnother}>{saved.length ? "清空搜索" : "解析第一道题 →"}</button></div>}
        </section>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-heading"><div><p className="eyebrow">AI CONFIGURATION</p><h2 id="settings-title">自定义系统 Prompt</h2></div><button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button></div>
            <p className="modal-copy">这里预留给未来的模型调用。你可以加入自己的讲解风格、输出要求或学习偏好。</p>
            <label htmlFor="system-prompt">系统 Prompt</label>
            <textarea id="system-prompt" className="prompt-editor" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            <div className="modal-footer"><button className="text-button reset-button" onClick={() => setSystemPrompt(defaultPrompt)}>恢复默认</button><div><button className="secondary-button" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary-button" onClick={savePrompt}>保存设置</button></div></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
