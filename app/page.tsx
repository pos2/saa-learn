"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SYSTEM_PROMPT, type Analysis, type AnalysisMeta, type KnowledgePointDetail, type KnowledgePointSummary, type SavedQuestion } from "../lib/domain";

type View = "dashboard" | "input" | "analysis" | "library" | "detail" | "knowledge" | "knowledgeDetail";

const STORAGE_KEY = "saa-learn-questions-v1";
const PROMPT_KEY = "saa-learn-system-prompt-v1";
const QUESTION_CONTEXT_KEY = "saa-learn-question-context-v1";
const PAGE_SIZE = 20;

type QuestionBrowseContext = {
  id: string;
  source: "library" | "knowledge" | "random";
  label: string;
  questionIds: string[];
  total?: number;
  returnView: "dashboard" | "library" | "knowledgeDetail";
  returnKnowledgeId?: string;
  randomFamiliarity?: number;
  search: string;
  mastery: "all" | SavedQuestion["mastery"];
  scrollY: number;
};

const exampleQuestion = `A company runs Amazon EC2 instances in a private subnet. The instances must access Amazon S3 without sending traffic over the public internet. The solution must minimize cost. Which solution meets these requirements?\n\nA. Deploy a NAT gateway in a public subnet.\nB. Create a gateway VPC endpoint for Amazon S3.\nC. Assign an Elastic IP address to each EC2 instance.\nD. Attach an internet gateway to the VPC.`;

const masteryLabels: Record<SavedQuestion["mastery"], string> = {
  unreviewed: "未复习",
  learning: "学习中",
  mastered: "已掌握",
};

const familiarityLabels = ["完全不熟悉", "刚刚见过", "有些印象", "基本理解", "比较熟悉", "非常熟悉"];
const familiarityColors = ["#d97863", "#df9b53", "#d9b84f", "#aebc4f", "#789c58", "#39745f"];

type FamiliarityStat = { familiarity: number; count: number };

function semanticTitle(item: SavedQuestion) {
  const stored = item.title.trim();
  const looksLikeExcerpt = item.original.trim().toLowerCase().startsWith(stored.toLowerCase());
  if (/[\u3400-\u9fff]/.test(stored) && !looksLikeExcerpt) return stored;
  const conclusion = item.analysis.summary.split(/[。！？]/)[0].trim();
  return conclusion.length > 46 ? `${conclusion.slice(0, 46)}…` : conclusion || "待补充题目标题";
}

function questionStem(original: string) {
  const beforeOptions = original.split(/\n\s*A[.、)]\s+/i)[0];
  return beforeOptions.replace(/\s+/g, " ").trim();
}

function optionContent(original: string, label: string, stored?: string) {
  if (stored?.trim()) return stored.trim();
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = original.match(new RegExp(`(?:^|\\n)\\s*${escaped}[.、)]\\s*([\\s\\S]*?)(?=\\n\\s*[A-H][.、)]\\s*|$)`, "i"));
  return match?.[1]?.trim() || "未能从原题中识别该选项内容";
}

function questionSequence(item: SavedQuestion) {
  return `#${String(item.sequence ?? 0).padStart(3, "0")}`;
}

function highlightText(text: string, search: string) {
  const terms = search.normalize("NFKC").trim().split(/[\s,，、;；]+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  const lookup = new Set(terms.map((term) => term.toLowerCase()));
  return parts.map((part, index) => lookup.has(part.toLowerCase()) ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [question, setQuestion] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [draftMastery, setDraftMastery] = useState<SavedQuestion["mastery"]>("unreviewed");
  const [draftCreatedAt, setDraftCreatedAt] = useState<string | null>(null);
  const [isEditingAnalysis, setIsEditingAnalysis] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [saved, setSaved] = useState<SavedQuestion[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [familiarityStats, setFamiliarityStats] = useState<FamiliarityStat[]>(
    () => Array.from({ length: 6 }, (_, familiarity) => ({ familiarity, count: 0 })),
  );
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isOpeningRandom, setIsOpeningRandom] = useState(false);
  const [knowledgePoints, setKnowledgePoints] = useState<KnowledgePointSummary[]>([]);
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [totalKnowledge, setTotalKnowledge] = useState(0);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgePointDetail | null>(null);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [isLoadingMoreKnowledge, setIsLoadingMoreKnowledge] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [masteryFilter, setMasteryFilter] = useState<"all" | SavedQuestion["mastery"]>("all");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [ready, setReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [questionContext, setQuestionContext] = useState<QuestionBrowseContext | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.sessionStorage.getItem(QUESTION_CONTEXT_KEY);
      return stored ? JSON.parse(stored) as QuestionBrowseContext : null;
    } catch {
      window.sessionStorage.removeItem(QUESTION_CONTEXT_KEY);
      return null;
    }
  });
  const [pendingScrollY, setPendingScrollY] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const legacyQuestions = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedQuestion[];
        const legacyPrompt = window.localStorage.getItem(PROMPT_KEY);
        if (legacyPrompt) {
          const response = await fetch("/api/settings/system-prompt", {
            method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: legacyPrompt }),
          });
          if (!response.ok) throw new Error("迁移系统 Prompt 失败");
        }
        if (legacyQuestions.length) {
          for (const record of legacyQuestions) {
            const response = await fetch("/api/questions", {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record),
            });
            if (!response.ok) throw new Error("迁移浏览器题目失败");
          }
        }

        const [questionResponse, promptResponse, dashboardResponse] = await Promise.all([
          fetch(`/api/questions?limit=${PAGE_SIZE}&offset=0`, { cache: "no-store" }),
          fetch("/api/settings/system-prompt", { cache: "no-store" }),
          fetch("/api/dashboard", { cache: "no-store" }),
        ]);
        if (!questionResponse.ok || !promptResponse.ok || !dashboardResponse.ok) throw new Error("学习数据初始化失败");
        const questionData = await questionResponse.json() as { questions: SavedQuestion[]; total: number };
        const promptData = await promptResponse.json() as { value: string };
        const dashboardData = await dashboardResponse.json() as { total: number; counts: FamiliarityStat[] };
        if (!cancelled) {
          setSaved(questionData.questions);
          setTotalQuestions(dashboardData.total);
          setTotalMatches(questionData.total);
          setFamiliarityStats(dashboardData.counts);
          setSystemPrompt(promptData.value);
          window.localStorage.removeItem(STORAGE_KEY);
          window.localStorage.removeItem(PROMPT_KEY);
        }
      } catch (error) {
        if (!cancelled) setToast(error instanceof Error ? error.message : "无法连接本地数据库");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function restoreLocation() {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("view") as View | null;
      if (!next || next === "dashboard" || !["input", "analysis", "library", "detail", "knowledge", "knowledgeDetail"].includes(next)) {
        setView("dashboard");
        return;
      }
      if (next === "input") {
        setView("input");
        return;
      }
      if (next === "library") {
        setSearch(params.get("search") ?? "");
        const mastery = params.get("mastery");
        setMasteryFilter(mastery === "unreviewed" || mastery === "learning" || mastery === "mastered" ? mastery : "all");
        setView("library");
        return;
      }
      if (next === "knowledge") {
        setKnowledgeSearch(params.get("search") ?? "");
        setView("knowledge");
        return;
      }
      if (next === "knowledgeDetail") {
        const id = params.get("knowledge");
        if (!id) { setView("knowledge"); return; }
        const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { cache: "no-store" });
        const payload = await response.json() as { knowledgePoint?: KnowledgePointDetail };
        if (!cancelled && response.ok && payload.knowledgePoint) {
          setSelectedKnowledge(payload.knowledgePoint);
          setView("knowledgeDetail");
        }
        return;
      }
      if (next === "detail") {
        const id = params.get("question");
        if (!id) { setView("library"); return; }
        try {
          const stored = window.sessionStorage.getItem(QUESTION_CONTEXT_KEY);
          if (stored) setQuestionContext(JSON.parse(stored) as QuestionBrowseContext);
        } catch { window.sessionStorage.removeItem(QUESTION_CONTEXT_KEY); }
        const response = await fetch(`/api/questions/${encodeURIComponent(id)}`, { cache: "no-store" });
        const payload = await response.json() as { question?: SavedQuestion };
        if (!cancelled && response.ok && payload.question) {
          setSaved((current) => current.some((item) => item.id === id) ? current : [...current, payload.question!]);
          setSelectedId(id);
          setAnswerRevealed(false);
          setView("detail");
        }
      }
    }
    const handlePopState = () => {
      void restoreLocation();
      const stored = window.sessionStorage.getItem(QUESTION_CONTEXT_KEY);
      if (stored) {
        try {
          const context = JSON.parse(stored) as QuestionBrowseContext;
          const target = new URLSearchParams(window.location.search).get("view");
          if (target === context.returnView) setPendingScrollY(context.scrollY);
        } catch { /* Ignore stale browsing context. */ }
      }
    };
    void restoreLocation();
    window.addEventListener("popstate", handlePopState);
    return () => { cancelled = true; window.removeEventListener("popstate", handlePopState); };
  }, [ready]);

  useEffect(() => {
    if (!ready || (view !== "library" && view !== "knowledge")) return;
    const params = new URLSearchParams({ view });
    if (view === "library") {
      if (search.trim()) params.set("search", search.trim());
      if (masteryFilter !== "all") params.set("mastery", masteryFilter);
    } else if (knowledgeSearch.trim()) params.set("search", knowledgeSearch.trim());
    window.history.replaceState({ view }, "", `${window.location.pathname}?${params}`);
  }, [knowledgeSearch, masteryFilter, ready, search, view]);

  useEffect(() => {
    if (pendingScrollY === null || (view !== "library" && view !== "knowledgeDetail")) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: pendingScrollY, behavior: "auto" });
      setPendingScrollY(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingScrollY, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!ready || view !== "library") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingQuestions(true);
      try {
        const params = new URLSearchParams({ search, mastery: masteryFilter, limit: String(PAGE_SIZE), offset: "0" });
        const response = await fetch(`/api/questions?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { questions?: SavedQuestion[]; total?: number; error?: string };
        if (!response.ok || !payload.questions || typeof payload.total !== "number") throw new Error(payload.error ?? "检索题库失败");
        setSaved(payload.questions);
        setTotalMatches(payload.total);
        if (!search.trim() && masteryFilter === "all") setTotalQuestions(payload.total);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setToast(error instanceof Error ? error.message : "检索题库失败");
      } finally {
        if (!controller.signal.aborted) setIsLoadingQuestions(false);
      }
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, masteryFilter, ready, view]);

  useEffect(() => {
    if (view !== "knowledge") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingKnowledge(true);
      try {
        const params = new URLSearchParams({ search: knowledgeSearch, limit: String(PAGE_SIZE), offset: "0" });
        const response = await fetch(`/api/knowledge?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { knowledgePoints?: KnowledgePointSummary[]; total?: number; error?: string };
        if (!response.ok || !payload.knowledgePoints || typeof payload.total !== "number") throw new Error(payload.error ?? "检索知识点失败");
        setKnowledgePoints(payload.knowledgePoints);
        setTotalKnowledge(payload.total);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setToast(error instanceof Error ? error.message : "检索知识点失败");
      } finally {
        if (!controller.signal.aborted) setIsLoadingKnowledge(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [knowledgeSearch, view]);

  const selected = saved.find((item) => item.id === selectedId) ?? null;
  const contextPosition = selectedId && questionContext
    ? questionContext.source === "random" ? questionContext.questionIds.lastIndexOf(selectedId) : questionContext.questionIds.indexOf(selectedId)
    : -1;
  const contextTotal = questionContext?.source === "library"
    ? Math.max(questionContext.total ?? totalMatches, questionContext.questionIds.length)
    : questionContext?.questionIds.length ?? 0;
  const contextProgress = contextPosition >= 0
    ? questionContext?.source === "random" ? String(contextPosition + 1) : `${contextPosition + 1} / ${contextTotal}`
    : null;
  const previousQuestionId = contextPosition > 0 ? questionContext!.questionIds[contextPosition - 1] : null;
  const nextQuestionId = questionContext && contextPosition >= 0 && contextPosition < questionContext.questionIds.length - 1
    ? questionContext.questionIds[contextPosition + 1]
    : null;
  const canLoadNextQuestion = Boolean(nextQuestionId)
    || questionContext?.source === "random"
    || Boolean(questionContext?.source === "library" && contextPosition >= 0 && questionContext.questionIds.length < (questionContext.total ?? totalMatches));
  const returnLabel = questionContext?.label ?? "我的题库";

  async function loadMoreQuestions() {
    if (isLoadingMore || saved.length >= totalMatches) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({ search, mastery: masteryFilter, limit: String(PAGE_SIZE), offset: String(saved.length) });
      const response = await fetch(`/api/questions?${params}`, { cache: "no-store" });
      const payload = await response.json() as { questions?: SavedQuestion[]; total?: number; error?: string };
      if (!response.ok || !payload.questions || typeof payload.total !== "number") throw new Error(payload.error ?? "加载更多题目失败");
      setSaved((current) => [...current, ...payload.questions!.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTotalMatches(payload.total);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载更多题目失败");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function loadMoreKnowledge() {
    if (isLoadingMoreKnowledge || knowledgePoints.length >= totalKnowledge) return;
    setIsLoadingMoreKnowledge(true);
    try {
      const params = new URLSearchParams({ search: knowledgeSearch, limit: String(PAGE_SIZE), offset: String(knowledgePoints.length) });
      const response = await fetch(`/api/knowledge?${params}`, { cache: "no-store" });
      const payload = await response.json() as { knowledgePoints?: KnowledgePointSummary[]; total?: number; error?: string };
      if (!response.ok || !payload.knowledgePoints || typeof payload.total !== "number") throw new Error(payload.error ?? "加载更多知识点失败");
      setKnowledgePoints((current) => [...current, ...payload.knowledgePoints!.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTotalKnowledge(payload.total);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载更多知识点失败");
    } finally {
      setIsLoadingMoreKnowledge(false);
    }
  }

  async function openKnowledgePoint(id: string) {
    setIsLoadingKnowledge(true);
    setSelectedKnowledge(null);
    setView("knowledgeDetail");
    window.history.pushState({ view: "knowledgeDetail", knowledge: id }, "", `${window.location.pathname}?${new URLSearchParams({ view: "knowledgeDetail", knowledge: id })}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json() as { knowledgePoint?: KnowledgePointDetail; error?: string };
      if (!response.ok || !payload.knowledgePoint) throw new Error(payload.error ?? "读取知识点失败");
      setSelectedKnowledge(payload.knowledgePoint);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "读取知识点失败");
      navigate("knowledge");
    } finally {
      setIsLoadingKnowledge(false);
    }
  }

  function persistQuestionContext(context: QuestionBrowseContext) {
    setQuestionContext(context);
    window.sessionStorage.setItem(QUESTION_CONTEXT_KEY, JSON.stringify(context));
  }

  function writeQuestionUrl(id: string, contextId: string) {
    const params = new URLSearchParams({ view: "detail", question: id, context: contextId });
    window.history.pushState({ view: "detail", question: id }, "", `${window.location.pathname}?${params}`);
  }

  function openRelatedQuestion(record: SavedQuestion) {
    const related = selectedKnowledge?.relatedQuestions ?? [record];
    setSaved((current) => [...current, ...related.filter((item) => !current.some((existing) => existing.id === item.id))]);
    const context: QuestionBrowseContext = {
      id: window.crypto.randomUUID(),
      source: "knowledge",
      label: selectedKnowledge ? `“${selectedKnowledge.title}”关联题目` : "关联题目",
      questionIds: related.map((item) => item.id),
      total: related.length,
      returnView: "knowledgeDetail",
      returnKnowledgeId: selectedKnowledge?.id,
      search,
      mastery: masteryFilter,
      scrollY: window.scrollY,
    };
    persistQuestionContext(context);
    setSelectedId(record.id);
    setAnswerRevealed(false);
    setView("detail");
    writeQuestionUrl(record.id, context.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(next: View) {
    setView(next);
    const params = new URLSearchParams();
    if (next !== "dashboard") params.set("view", next);
    if (next === "library") {
      if (search.trim()) params.set("search", search.trim());
      if (masteryFilter !== "all") params.set("mastery", masteryFilter);
    }
    window.history.pushState({ view: next }, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function searchQuestionsByTag(tag: string) {
    setSearch(tag);
    setMasteryFilter("all");
    navigate("library");
  }

  async function runAnalysis(original: string) {
    if (!original.trim()) return;
    setIsAnalyzing(true);
    setToast("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: original }),
      });
      const payload = await response.json() as { analysis?: Analysis; runId?: string; analysisMeta?: AnalysisMeta; error?: string };
      if (!response.ok || !payload.analysis || !payload.runId) throw new Error(payload.error ?? "解析题目失败");
      setQuestion(original);
      setAnalysis(payload.analysis);
      setAnalysisRunId(payload.runId);
      setAnalysisMeta(payload.analysisMeta ?? null);
      setIsEditingAnalysis(false);
      navigate("analysis");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "解析题目失败");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function analyzeQuestion() {
    setEditingQuestionId(null);
    setDraftMastery("unreviewed");
    setDraftCreatedAt(null);
    await runAnalysis(question);
  }

  async function reanalyzeSelected() {
    if (!selected) return;
    setEditingQuestionId(selected.id);
    setDraftMastery(selected.mastery);
    setDraftCreatedAt(selected.createdAt);
    await runAnalysis(selected.original);
  }

  async function saveQuestion() {
    if (!analysis || isSaving) return;
    const record: SavedQuestion = {
      id: editingQuestionId ?? window.crypto.randomUUID(),
      original: question,
      title: analysis.title,
      analysis,
      analysisRunId: analysisRunId ?? undefined,
      analysisMeta: analysisMeta ?? undefined,
      mastery: draftMastery,
      familiarity: editingQuestionId ? saved.find((item) => item.id === editingQuestionId)?.familiarity ?? 0 : 0,
      createdAt: draftCreatedAt ?? new Date().toISOString(),
    };
    setIsSaving(true);
    try {
      const response = await fetch("/api/questions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record),
      });
      const payload = await response.json() as { question?: SavedQuestion; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error ?? "保存题目失败");
      setSaved((current) => [payload.question!, ...current.filter((item) => item.id !== payload.question!.id)]);
      if (!editingQuestionId) {
        setTotalQuestions((current) => current + 1);
        setTotalMatches((current) => current + 1);
        setFamiliarityStats((current) => current.map((item) => item.familiarity === 0 ? { ...item, count: item.count + 1 } : item));
      }
      setSelectedId(payload.question.id);
      setEditingQuestionId(payload.question.id);
      setSearch("");
      setMasteryFilter("all");
      setToast("题目已保存到本地数据库");
      window.setTimeout(() => setToast(""), 2400);
      navigate("library");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存题目失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeQuestion(id: string) {
    try {
      const removed = saved.find((item) => item.id === id);
      const response = await fetch(`/api/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除题目失败");
      setSaved((current) => current.filter((item) => item.id !== id));
      setTotalQuestions((current) => Math.max(0, current - 1));
      setTotalMatches((current) => Math.max(0, current - 1));
      if (removed) setFamiliarityStats((current) => current.map((item) => item.familiarity === removed.familiarity ? { ...item, count: Math.max(0, item.count - 1) } : item));
      navigate("library");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除题目失败");
    }
  }

  function openQuestion(id: string) {
    const filterLabel = search.trim()
      ? `“${search.trim()}”检索结果`
      : masteryFilter !== "all" ? `${masteryLabels[masteryFilter]}题目` : "我的题库";
    const context: QuestionBrowseContext = {
      id: window.crypto.randomUUID(),
      source: "library",
      label: filterLabel,
      questionIds: saved.map((item) => item.id),
      total: totalMatches,
      returnView: "library",
      search,
      mastery: masteryFilter,
      scrollY: window.scrollY,
    };
    persistQuestionContext(context);
    setSelectedId(id);
    setAnswerRevealed(false);
    setView("detail");
    writeQuestionUrl(id, context.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openContextQuestion(id: string | null) {
    if (!id || !questionContext) return;
    let record = saved.find((item) => item.id === id);
    if (!record) {
      try {
        const response = await fetch(`/api/questions/${encodeURIComponent(id)}`, { cache: "no-store" });
        const payload = await response.json() as { question?: SavedQuestion; error?: string };
        if (!response.ok || !payload.question) throw new Error(payload.error ?? "读取题目失败");
        record = payload.question;
        setSaved((current) => current.some((item) => item.id === id) ? current : [...current, payload.question!]);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "读取题目失败");
        return;
      }
    }
    setSelectedId(record.id);
    setAnswerRevealed(false);
    setView("detail");
    writeQuestionUrl(record.id, questionContext.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openNextContextQuestion() {
    if (nextQuestionId) {
      await openContextQuestion(nextQuestionId);
      return;
    }
    if (questionContext?.source === "random") {
      await openRandomQuestion(questionContext);
      return;
    }
    if (!questionContext || questionContext.source !== "library" || questionContext.questionIds.length >= (questionContext.total ?? totalMatches)) return;
    try {
      const params = new URLSearchParams({
        search: questionContext.search,
        mastery: questionContext.mastery,
        limit: String(PAGE_SIZE),
        offset: String(questionContext.questionIds.length),
      });
      const response = await fetch(`/api/questions?${params}`, { cache: "no-store" });
      const payload = await response.json() as { questions?: SavedQuestion[]; total?: number; error?: string };
      if (!response.ok || !payload.questions?.length) throw new Error(payload.error ?? "没有更多题目");
      const freshQuestions = payload.questions.filter((item) => !questionContext.questionIds.includes(item.id));
      if (!freshQuestions.length) throw new Error("没有更多题目");
      const expandedContext = { ...questionContext, total: payload.total ?? questionContext.total, questionIds: [...questionContext.questionIds, ...freshQuestions.map((item) => item.id)] };
      persistQuestionContext(expandedContext);
      setSaved((current) => [...current, ...freshQuestions.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTotalMatches(payload.total ?? totalMatches);
      setSelectedId(freshQuestions[0].id);
      setAnswerRevealed(false);
      writeQuestionUrl(freshQuestions[0].id, expandedContext.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载下一题失败");
    }
  }

  async function openRandomQuestion(existingContext?: QuestionBrowseContext, familiarity?: number, total?: number) {
    if (isOpeningRandom) return;
    setIsOpeningRandom(true);
    try {
      const searchParams = new URLSearchParams();
      existingContext?.questionIds.slice(-200).forEach((id) => searchParams.append("exclude", id));
      const selectedFamiliarity = existingContext?.randomFamiliarity ?? familiarity;
      if (selectedFamiliarity !== undefined) searchParams.set("familiarity", String(selectedFamiliarity));
      const response = await fetch(`/api/questions/random${searchParams.size ? `?${searchParams}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as { question?: SavedQuestion; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error ?? "随机选题失败");
      const record = payload.question;
      const context: QuestionBrowseContext = existingContext
        ? { ...existingContext, questionIds: [...existingContext.questionIds, record.id] }
        : {
            id: window.crypto.randomUUID(), source: "random",
            label: selectedFamiliarity === undefined ? "低熟悉度随机练习" : `${selectedFamiliarity} 星题目`,
            questionIds: [record.id], total: selectedFamiliarity === undefined ? 1 : total,
            returnView: selectedFamiliarity === undefined ? "library" : "dashboard",
            randomFamiliarity: selectedFamiliarity,
            search, mastery: masteryFilter, scrollY: window.scrollY,
          };
      persistQuestionContext(context);
      setSaved((current) => current.some((item) => item.id === record.id) ? current : [...current, record]);
      setSelectedId(record.id);
      setAnswerRevealed(false);
      setView("detail");
      writeQuestionUrl(record.id, context.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "随机选题失败");
    } finally {
      setIsOpeningRandom(false);
    }
  }

  async function returnToQuestionSource() {
    if (!questionContext) {
      navigate("library");
      return;
    }
    setSearch(questionContext.search);
    setMasteryFilter(questionContext.mastery);
    if (questionContext.returnView === "knowledgeDetail" && questionContext.returnKnowledgeId) {
      if (selectedKnowledge?.id !== questionContext.returnKnowledgeId) {
        try {
          const response = await fetch(`/api/knowledge/${encodeURIComponent(questionContext.returnKnowledgeId)}`, { cache: "no-store" });
          const payload = await response.json() as { knowledgePoint?: KnowledgePointDetail; error?: string };
          if (!response.ok || !payload.knowledgePoint) throw new Error(payload.error ?? "读取知识点失败");
          setSelectedKnowledge(payload.knowledgePoint);
        } catch (error) {
          setToast(error instanceof Error ? error.message : "读取知识点失败");
          setView("knowledge");
          return;
        }
      }
      setView("knowledgeDetail");
    } else {
      setView(questionContext.returnView === "dashboard" ? "dashboard" : "library");
    }
    setPendingScrollY(questionContext.scrollY);
    const params = new URLSearchParams({ view: questionContext.returnView });
    if (questionContext.returnView === "dashboard") params.delete("view");
    if (questionContext.returnView === "library" && questionContext.search.trim()) params.set("search", questionContext.search.trim());
    if (questionContext.returnView === "library" && questionContext.mastery !== "all") params.set("mastery", questionContext.mastery);
    if (questionContext.returnKnowledgeId) params.set("knowledge", questionContext.returnKnowledgeId);
    window.history.pushState({ view: questionContext.returnView }, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function startAnother() {
    setQuestion("");
    setAnalysis(null);
    setAnalysisRunId(null);
    setAnalysisMeta(null);
    setEditingQuestionId(null);
    setDraftMastery("unreviewed");
    setDraftCreatedAt(null);
    setIsEditingAnalysis(false);
    setAnswerRevealed(false);
    navigate("input");
  }

  function updateAnalysis(patch: Partial<Analysis>) {
    setAnalysis((current) => current ? { ...current, ...patch } : current);
  }

  function splitTags(value: string) {
    return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }

  async function changeMastery(mastery: SavedQuestion["mastery"]) {
    if (!selected) return;
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(selected.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mastery }),
      });
      const payload = await response.json() as { question?: SavedQuestion; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error ?? "更新掌握状态失败");
      setSaved((current) => current.map((item) => item.id === selected.id ? payload.question! : item));
      setToast(`已标记为${mastery === "mastered" ? "已掌握" : mastery === "learning" ? "学习中" : "未复习"}`);
      window.setTimeout(() => setToast(""), 1800);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "更新掌握状态失败");
    }
  }

  async function changeFamiliarity(familiarity: number) {
    if (!selected) return;
    const previousFamiliarity = selected.familiarity;
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(selected.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ familiarity }),
      });
      const payload = await response.json() as { question?: SavedQuestion; error?: string };
      if (!response.ok || !payload.question) throw new Error(payload.error ?? "更新熟悉度失败");
      setSaved((current) => current.map((item) => item.id === selected.id ? payload.question! : item));
      if (previousFamiliarity !== familiarity) {
        setFamiliarityStats((current) => current.map((item) => item.familiarity === previousFamiliarity
          ? { ...item, count: Math.max(0, item.count - 1) }
          : item.familiarity === familiarity ? { ...item, count: item.count + 1 } : item));
      }
      setToast(`熟悉度已设为 ${familiarity} 星 · ${familiarityLabels[familiarity]}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "更新熟悉度失败");
    }
  }

  async function savePrompt() {
    try {
      const response = await fetch("/api/settings/system-prompt", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: systemPrompt }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存 Prompt 失败");
      setSettingsOpen(false);
      setToast("系统 Prompt 已保存到本地数据库");
      window.setTimeout(() => setToast(""), 2200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存 Prompt 失败");
    }
  }

  const currentQuestion = view === "detail" ? selected?.original : question;
  const currentAnalysis = view === "detail" ? selected?.analysis : analysis;
  const currentAnalysisMeta = view === "detail" ? selected?.analysisMeta : analysisMeta;
  const lowFamiliarityCount = familiarityStats.slice(0, 3).reduce((sum, item) => sum + item.count, 0);
  const averageFamiliarity = totalQuestions
    ? familiarityStats.reduce((sum, item) => sum + item.familiarity * item.count, 0) / totalQuestions
    : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand plain-button" onClick={() => navigate("dashboard")} aria-label="SAA Learn 学习概览">
          <span className="brand-mark">S</span><span>SAA Learn</span>
        </button>
        <nav className="nav" aria-label="主导航">
          <button className={`nav-link ${view === "dashboard" ? "active" : ""}`} onClick={() => navigate("dashboard")}>学习概览</button>
          <button className={`nav-link ${view === "input" || view === "analysis" ? "active" : ""}`} onClick={() => navigate("input")}>题目解析</button>
          <button className={`nav-link ${view === "library" || view === "detail" ? "active" : ""}`} onClick={() => navigate("library")}>我的题库 <span className="count-badge">{ready ? totalQuestions : 0}</span></button>
          <button className={`nav-link ${view === "knowledge" || view === "knowledgeDetail" ? "active" : ""}`} onClick={() => navigate("knowledge")}>知识点</button>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开系统 Prompt 设置">⚙</button>
          <a className="nav-link logout-link" href="/auth/logout">退出访问</a>
        </nav>
      </header>

      {view === "dashboard" && (
        <section className="workspace dashboard-view">
          <div className="dashboard-hero">
            <div>
              <p className="eyebrow">LEARNING DASHBOARD</p>
              <h1>你的 SAA<br />熟悉度地图。</h1>
              <p className="intro-copy">从最不熟悉的部分开始复习，让每一次随机抽题都更接近薄弱点。</p>
            </div>
            <div className="dashboard-summary" aria-label="题库学习概览">
              <div><span>题库总数</span><strong>{ready ? totalQuestions : "—"}</strong><small>道题</small></div>
              <div><span>平均熟悉度</span><strong>{ready ? averageFamiliarity.toFixed(1) : "—"}</strong><small>/ 5 星</small></div>
              <div className="priority-summary"><span>优先复习</span><strong>{ready ? lowFamiliarityCount : "—"}</strong><small>道 · 0–2 星</small></div>
            </div>
          </div>

          <section className="distribution-panel" aria-labelledby="distribution-title">
            <div className="distribution-heading">
              <div><span className="section-caption">熟悉度分布</span><h2 id="distribution-title">按评级选择今天的复习范围</h2></div>
              <button className="secondary-button" type="button" disabled={!totalQuestions || isOpeningRandom} onClick={() => void openRandomQuestion()}>{isOpeningRandom ? "正在抽取题目…" : "✦ 智能随机复习"}</button>
            </div>
            <div className="distribution-bar" aria-label="各熟悉度题目占比">
              {familiarityStats.map((item) => <span key={item.familiarity} style={{ flexGrow: item.count, background: familiarityColors[item.familiarity] }} title={`${item.familiarity} 星：${item.count} 道`} />)}
              {!totalQuestions && <span className="distribution-empty" />}
            </div>
            <div className="rating-grid">
              {familiarityStats.map((item) => {
                const percentage = totalQuestions ? Math.round(item.count / totalQuestions * 100) : 0;
                return <button
                  type="button"
                  className="rating-card"
                  key={item.familiarity}
                  disabled={!item.count || isOpeningRandom}
                  onClick={() => void openRandomQuestion(undefined, item.familiarity, item.count)}
                  style={{ "--rating-color": familiarityColors[item.familiarity] } as React.CSSProperties}
                  aria-label={`随机复习 ${item.familiarity} 星题目，共 ${item.count} 道`}
                >
                  <span className="rating-card-top"><strong>{item.familiarity}<small> 星</small></strong><em>{percentage}%</em></span>
                  <span className="rating-label">{familiarityLabels[item.familiarity]}</span>
                  <span className="rating-count"><b>{item.count}</b> 道题</span>
                  <span className="rating-progress"><i style={{ width: `${percentage}%` }} /></span>
                  <span className="rating-action">{!item.count ? "暂无题目" : isOpeningRandom ? "正在抽取…" : "随机浏览 →"}</span>
                </button>;
              })}
            </div>
          </section>

          <div className="dashboard-footer-actions">
            <p>新题默认归入 0 星，复习后可以在详情页随时调整评级。</p>
            <button className="primary-button" type="button" onClick={startAnother}>＋ 解析新题目</button>
          </div>
        </section>
      )}

      {view === "input" && (
        <section className="workspace input-view">
          <div className="intro-row">
            <div>
              <p className="eyebrow">AI 学习工作台</p>
              <h1>从一道题，补齐一片知识。</h1>
              <p className="intro-copy">粘贴英文 SAA 题目，DeepSeek 会保留原题，并用中文讲解答案、选项和相关知识点。</p>
            </div>
            <div className="progress-chip"><span>已收录</span><strong>{totalQuestions}</strong><span>道题</span></div>
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
          <div className="trust-row"><span>✦ 英文原题完整保留</span><span>中 解析统一使用中文</span><span>◉ 自动生成候选分类</span></div>
        </section>
      )}

      {(view === "analysis" || view === "detail") && currentAnalysis && currentQuestion && (
        <section className="workspace result-view">
          <div className="result-topline">
            <button className="back-button" onClick={() => view === "detail" ? void returnToQuestionSource() : navigate("input")}>← {view === "detail" ? `返回${returnLabel}` : "修改题目"}</button>
            <span className="prototype-note">{view === "detail" ? "已保存记录" : "DeepSeek V4 Flash 中文解析 · 保存前请确认"}</span>
          </div>
          {view === "detail" && contextProgress && <nav className="question-context-nav" aria-label="当前题组导航">
            <button type="button" disabled={!previousQuestionId} onClick={() => void openContextQuestion(previousQuestionId)}>← 上一题</button>
            <div><span>{returnLabel}</span><strong>第 {contextProgress} 题</strong></div>
            <button type="button" disabled={!canLoadNextQuestion || isOpeningRandom} onClick={() => void openNextContextQuestion()}>{isOpeningRandom ? "抽取中…" : "下一题 →"}</button>
          </nav>}
          <div className="result-hero">
            <div><p className="eyebrow">{view === "detail" ? "题目详情" : "解析完成"}</p><h1>{view === "detail" && selected ? semanticTitle(selected) : "答案不只是一个选项。"}</h1></div>
            {view === "analysis" && <div className="action-group"><button className="secondary-button" disabled={isAnalyzing} onClick={() => runAnalysis(question)}>{isAnalyzing ? "重新解析中…" : "重新解析"}</button><button className="secondary-button" onClick={() => setIsEditingAnalysis((value) => !value)}>{isEditingAnalysis ? "完成编辑" : "编辑解析"}</button><button className="primary-button" disabled={isSaving || isAnalyzing} onClick={saveQuestion}>{isSaving ? "正在保存…" : "保存到题库"} <span>✓</span></button></div>}
          </div>

          {currentAnalysisMeta && <div className="analysis-meta" aria-label="本次模型调用信息">
            <span>{currentAnalysisMeta.model}</span><span>{currentAnalysisMeta.totalTokens.toLocaleString()} tokens</span><span>{currentAnalysisMeta.attemptCount} 次尝试</span><span>{(currentAnalysisMeta.latencyMs / 1000).toFixed(1)} 秒</span>
          </div>}

          {view === "analysis" && isEditingAnalysis && analysis && <section className="analysis-editor" aria-label="编辑解析结果">
            <div className="editor-heading"><div><span className="section-caption">保存前校正</span><h2>编辑 AI 解析</h2></div><p>答案必须与勾选的正确选项一致；选项不可遗漏。</p></div>
            <div className="editor-grid">
              <label className="wide"><span>中文语义标题</span><input value={analysis.title} maxLength={64} onChange={(event) => updateAnalysis({ title: event.target.value })} /></label>
              <label><span>建议答案</span><input value={analysis.answer} onChange={(event) => updateAnalysis({ answer: event.target.value.toUpperCase() })} /></label>
              <label className="wide"><span>解题结论</span><textarea value={analysis.summary} onChange={(event) => updateAnalysis({ summary: event.target.value })} /></label>
              <label><span>涉及服务（逗号分隔）</span><input value={analysis.services.join(", ")} onChange={(event) => updateAnalysis({ services: splitTags(event.target.value) })} /></label>
              <label><span>候选题型（逗号分隔）</span><input value={analysis.topics.join(", ")} onChange={(event) => updateAnalysis({ topics: splitTags(event.target.value) })} /></label>
              <label className="wide"><span>检索关键词（逗号分隔）</span><input value={analysis.keywords.join(", ")} onChange={(event) => updateAnalysis({ keywords: splitTags(event.target.value) })} /></label>
            </div>
            <div className="editor-options">{analysis.optionNotes.map((option, index) => <div className="editor-option" key={`${option.label}-${index}`}>
              <label className="correct-check"><input type="checkbox" checked={option.correct} onChange={(event) => updateAnalysis({ optionNotes: analysis.optionNotes.map((item, itemIndex) => itemIndex === index ? { ...item, correct: event.target.checked } : item) })} /><span>{option.label} 为正确选项</span></label>
              <textarea value={option.text} onChange={(event) => updateAnalysis({ optionNotes: analysis.optionNotes.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} />
            </div>)}</div>
            <div className="editor-knowledge">{analysis.knowledge.map((item, index) => <fieldset key={`${item.title}-${index}`}><legend>知识点 {index + 1}</legend>
              <label><span>标题</span><input value={item.title} onChange={(event) => updateAnalysis({ knowledge: analysis.knowledge.map((point, pointIndex) => pointIndex === index ? { ...point, title: event.target.value } : point) })} /></label>
              <label><span>内容</span><textarea value={item.body} onChange={(event) => updateAnalysis({ knowledge: analysis.knowledge.map((point, pointIndex) => pointIndex === index ? { ...point, body: event.target.value } : point) })} /></label>
              <label><span>考试线索</span><textarea value={item.cue} onChange={(event) => updateAnalysis({ knowledge: analysis.knowledge.map((point, pointIndex) => pointIndex === index ? { ...point, cue: event.target.value } : point) })} /></label>
            </fieldset>)}</div>
          </section>}

          {view === "detail" ? <section className="study-question" aria-label="题目与选项">
            <article className="study-stem">
              <div className="panel-label"><span>题目</span><span>QUESTION</span></div>
              <p>{questionStem(currentQuestion)}</p>
              {answerRevealed && <div className="study-stem-summary"><span>解题结论</span><p>{currentAnalysis.summary}</p></div>}
            </article>
            <div className={`study-options ${answerRevealed ? "revealed" : ""}`}>
              <div className="study-options-heading"><div><span className="section-caption">选项</span><h2>选择你认为正确的答案</h2></div>{answerRevealed && <span className="reference-answer">参考答案 {currentAnalysis.answer}</span>}</div>
              <div className="study-option-list">{currentAnalysis.optionNotes.map((option) => (
                <article className={`study-option ${answerRevealed && option.correct ? "correct" : ""}`} key={option.label}>
                  <span className="study-option-letter">{option.label}</span>
                  <div className="study-option-content"><p>{optionContent(currentQuestion, option.label, option.content)}</p>{answerRevealed && <div className="study-option-explanation"><strong>{option.correct ? "正确选项" : "选项解析"}</strong><p>{option.text}</p></div>}</div>
                  {answerRevealed && <span className="study-option-verdict" aria-label={option.correct ? "正确" : "错误"}>{option.correct ? "✓" : "×"}</span>}
                </article>
              ))}</div>
              <div className="reveal-row"><button className={answerRevealed ? "secondary-button" : "primary-button"} type="button" onClick={() => setAnswerRevealed((value) => !value)}>{answerRevealed ? "隐藏参考答案与解析" : "揭晓参考答案与解析"}<span aria-hidden="true">{answerRevealed ? "↑" : "↓"}</span></button></div>
            </div>
          </section> : <div className="result-grid">
            <article className="question-panel panel">
              <div className="panel-label"><span>原始题目</span><span>RAW</span></div>
              <pre>{currentQuestion}</pre>
            </article>
            <article className="answer-panel panel">
              <div className="answer-orb"><span>建议答案</span><strong>{currentAnalysis.answer}</strong></div>
              <div><h2>解题结论</h2><p>{currentAnalysis.summary}</p></div>
            </article>
          </div>}

          {(view === "analysis" || answerRevealed) && <div className="tag-section">
            <div><span className="section-caption">涉及服务</span><div className="tag-list">{currentAnalysis.services.map((tag) => view === "detail" ? <button type="button" className="tag service tag-link" key={tag} aria-label={`在题库中检索服务：${tag}`} onClick={() => searchQuestionsByTag(tag)}>{tag}<span aria-hidden="true">↗</span></button> : <span className="tag service" key={tag}>{tag}</span>)}</div></div>
            <div><span className="section-caption">AI 候选题型</span><div className="tag-list">{currentAnalysis.topics.map((tag) => view === "detail" ? <button type="button" className="tag tag-link" key={tag} aria-label={`在题库中检索题型：${tag}`} onClick={() => searchQuestionsByTag(tag)}>{tag}<small>候选</small><span aria-hidden="true">↗</span></button> : <span className="tag" key={tag}>{tag} <small>候选</small></span>)}</div></div>
          </div>}

          {view === "detail" && selected && <section className="mastery-panel" aria-label="掌握状态">
            <div><span className="section-caption">掌握状态</span><strong>{masteryLabels[selected.mastery]}</strong></div>
            <div className="mastery-switch">
              {(Object.keys(masteryLabels) as SavedQuestion["mastery"][]).map((status) => <button key={status} className={selected.mastery === status ? "active" : ""} onClick={() => changeMastery(status)}>{masteryLabels[status]}</button>)}
            </div>
          </section>}

          {view === "detail" && selected && <section className="familiarity-panel" aria-label="题目熟悉度">
            <div><span className="section-caption">熟悉程度</span><strong>{selected.familiarity} 星 · {familiarityLabels[selected.familiarity]}</strong><p>评级越低，随机复习时越容易抽到。</p></div>
            <div className="familiarity-control">
              <button type="button" className={selected.familiarity === 0 ? "zero active" : "zero"} onClick={() => void changeFamiliarity(0)} aria-label="设为 0 星，完全不熟悉">0 星</button>
              <div className="star-rating" aria-label={`当前熟悉度 ${selected.familiarity} 星`}>
                {[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} className={rating <= selected.familiarity ? "active" : ""} onClick={() => void changeFamiliarity(rating)} aria-label={`设为 ${rating} 星`}>★</button>)}
              </div>
            </div>
          </section>}

          {view === "analysis" && <section className="content-section">
            <div className="section-title"><span className="step-number">02</span><div><h2>逐项拆解</h2><p>先看每个选项在什么条件下成立。</p></div></div>
            <div className="option-list">{currentAnalysis.optionNotes.map((option) => (
              <article className={`option-row ${option.correct ? "correct" : ""}`} key={option.label}>
                <span className="option-letter">{option.label}</span><div><strong>{option.correct ? "正确选项" : "不推荐"}</strong><p>{option.text}</p></div><span className="verdict">{option.correct ? "✓" : "×"}</span>
              </article>
            ))}</div>
          </section>}

          {(view === "analysis" || answerRevealed) && <section className="content-section knowledge-section">
            <div className="section-title">{view === "analysis" && <span className="step-number">03</span>}<div><h2>关联知识点</h2><p>知识点会成为以后检索和归类的入口。</p></div></div>
            <div className="knowledge-grid">{currentAnalysis.knowledge.map((item, index) => (
              <article className="knowledge-card" key={item.title}><span className="knowledge-index">0{index + 1}</span><h3>{item.id ? <button className="knowledge-title-button" onClick={() => openKnowledgePoint(item.id!)}>{item.title} <span>→</span></button> : item.title}</h3><p>{item.body}</p><div className="exam-cue"><span>考试线索</span>{item.cue}</div></article>
            ))}</div>
          </section>}

          {(view === "analysis" || answerRevealed) && <section className="keyword-bar"><span>检索关键词</span>{currentAnalysis.keywords.map((word) => <button key={word} onClick={() => { setSearch(word); navigate("library"); }}>#{word}</button>)}</section>}
          {view === "detail" && <div className="detail-actions"><button className="danger-button" onClick={() => selected && removeQuestion(selected.id)}>删除这道题</button><div className="action-group"><button className="secondary-button" disabled={isAnalyzing} onClick={reanalyzeSelected}>{isAnalyzing ? "重新解析中…" : "重新解析此题"}</button><button className="primary-button" onClick={startAnother}>解析新题目 →</button></div></div>}
          {view === "analysis" && <div className="sticky-save"><span>确认答案和候选分类后再保存</span><button className="primary-button" disabled={isSaving} onClick={saveQuestion}>{isSaving ? "正在写入数据库…" : "保存并查看题库 ✓"}</button></div>}
        </section>
      )}

      {view === "library" && (
        <section className="workspace library-view" id="library">
          <div className="library-header"><div><p className="eyebrow">PERSONAL QUESTION BANK</p><h1>我的题库</h1><p className="intro-copy">从题目原文、知识点、服务和候选分类中检索。</p></div><div className="action-group"><button className="secondary-button random-study-button" disabled={isOpeningRandom} onClick={() => void openRandomQuestion()}>{isOpeningRandom ? "正在抽取题目…" : "✦ 低熟悉度随机复习"}</button><button className="primary-button" onClick={startAnother}>＋ 添加题目</button></div></div>
          <div className="search-box"><span>⌕</span><label className="sr-only" htmlFor="search">搜索题库</label><input id="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 S3、私有子网、成本优化…" />{search && <button onClick={() => setSearch("")} aria-label="清空搜索">×</button>}</div>
          <p className="search-hint">支持多个关键词、AWS 中英文别名和相关度排序；多个关键词需要同时命中。</p>
          <div className="filter-row" aria-label="按掌握状态筛选">
            <button className={masteryFilter === "all" ? "active" : ""} onClick={() => setMasteryFilter("all")}>全部</button>
            {(Object.keys(masteryLabels) as SavedQuestion["mastery"][]).map((status) => <button key={status} className={masteryFilter === status ? "active" : ""} onClick={() => setMasteryFilter(status)}>{masteryLabels[status]}</button>)}
          </div>
          <div className="library-meta"><span>{!ready ? "正在连接数据库…" : isLoadingQuestions ? "正在检索…" : `找到 ${totalMatches} 道题目`}</span><span>{saved.length ? `已加载 ${saved.length} / ${totalMatches}` : "数据库全文检索"}</span></div>
          {saved.length > 0 ? <><div className={`question-list ${isLoadingQuestions ? "loading" : ""}`}>{saved.map((item) => (
            <button className="question-item" onClick={() => openQuestion(item.id)} key={item.id}>
              <div className="question-main">
                <div className="question-item-top"><span className="question-sequence">{questionSequence(item)}</span><span>{item.analysis.services[0] ?? "AWS SAA"}</span><span className={`mastery-badge ${item.mastery}`}>{masteryLabels[item.mastery]}</span><span className="familiarity-badge">★ {item.familiarity}</span></div>
                <h2>{highlightText(semanticTitle(item), search)}</h2>
                <div className="question-preview"><span>英文原题</span><p>{highlightText(questionStem(item.original), search)}</p></div>
                <p className="question-conclusion"><span>核心结论</span>{item.analysis.summary}</p>
                <div className="question-item-footer"><div className="mini-tags">{item.analysis.topics.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><time>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time></div>
              </div>
              <span className="row-arrow">→</span>
            </button>
          ))}</div>{saved.length < totalMatches && <div className="load-more-row"><button className="secondary-button" disabled={isLoadingMore || isLoadingQuestions} onClick={loadMoreQuestions}>{isLoadingMore ? "正在加载…" : `加载更多（还有 ${totalMatches - saved.length} 道）`}</button></div>}</> : !isLoadingQuestions && <div className="empty-state"><span className="empty-orb">◎</span><h2>{search.trim() || masteryFilter !== "all" ? "没有匹配的题目" : "你的题库还是空的"}</h2><p>{search.trim() || masteryFilter !== "all" ? "换一个关键词，或清空搜索和筛选条件。" : "从一道真实遇到的题开始，知识体系会自然长出来。"}</p><button className="primary-button" onClick={search.trim() || masteryFilter !== "all" ? () => { setSearch(""); setMasteryFilter("all"); } : startAnother}>{search.trim() || masteryFilter !== "all" ? "清空检索条件" : "解析第一道题 →"}</button></div>}
        </section>
      )}

      {view === "knowledge" && (
        <section className="workspace knowledge-library-view">
          <div className="library-header"><div><p className="eyebrow">KNOWLEDGE LIBRARY</p><h1>知识点</h1><p className="intro-copy">从解析中沉淀可复用的概念，并查看每个知识点关联的题目。</p></div><span className="knowledge-total">{totalKnowledge} 个知识点</span></div>
          <div className="search-box"><span>⌕</span><label className="sr-only" htmlFor="knowledge-search">搜索知识点</label><input id="knowledge-search" value={knowledgeSearch} onChange={(event) => setKnowledgeSearch(event.target.value)} placeholder="搜索 Gateway Endpoint、成本优化、私有访问…" />{knowledgeSearch && <button onClick={() => setKnowledgeSearch("")} aria-label="清空知识点搜索">×</button>}</div>
          <div className="library-meta"><span>{isLoadingKnowledge ? "正在检索…" : `找到 ${totalKnowledge} 个知识点`}</span><span>{knowledgePoints.length ? `已加载 ${knowledgePoints.length} / ${totalKnowledge}` : "按关联题目数量排序"}</span></div>
          {knowledgePoints.length > 0 ? <><div className={`knowledge-list ${isLoadingKnowledge ? "loading" : ""}`}>{knowledgePoints.map((point) => <button className="knowledge-list-item" key={point.id} onClick={() => openKnowledgePoint(point.id)}>
            <div className="knowledge-list-heading"><span>{point.questionCount} 道关联题</span><span>查看知识点 →</span></div>
            <h2>{highlightText(point.title, knowledgeSearch)}</h2>
            <p>{highlightText(point.body, knowledgeSearch)}</p>
            <div className="knowledge-list-cue"><span>考试线索</span>{highlightText(point.cue, knowledgeSearch)}</div>
          </button>)}</div>{knowledgePoints.length < totalKnowledge && <div className="load-more-row"><button className="secondary-button" disabled={isLoadingMoreKnowledge || isLoadingKnowledge} onClick={loadMoreKnowledge}>{isLoadingMoreKnowledge ? "正在加载…" : `加载更多（还有 ${totalKnowledge - knowledgePoints.length} 个）`}</button></div>}</> : !isLoadingKnowledge && <div className="empty-state"><span className="empty-orb">◇</span><h2>{knowledgeSearch ? "没有匹配的知识点" : "尚未沉淀知识点"}</h2><p>{knowledgeSearch ? "尝试 AWS 服务名、中文概念或考试场景。" : "保存带有知识点解析的题目后会自动出现在这里。"}</p>{knowledgeSearch && <button className="primary-button" onClick={() => setKnowledgeSearch("")}>清空搜索</button>}</div>}
        </section>
      )}

      {view === "knowledgeDetail" && (
        <section className="workspace knowledge-detail-view">
          <button className="back-button" onClick={() => navigate("knowledge")}>← 返回知识点</button>
          {isLoadingKnowledge && !selectedKnowledge ? <div className="knowledge-loading">正在整理知识点及关联题目…</div> : selectedKnowledge && <>
            <div className="knowledge-detail-hero"><div><p className="eyebrow">KNOWLEDGE POINT</p><h1>{selectedKnowledge.title}</h1></div><span>{selectedKnowledge.questionCount} 道关联题目</span></div>
            <article className="knowledge-detail-body"><span>知识讲解</span><p>{selectedKnowledge.body}</p><div><strong>考试线索</strong><p>{selectedKnowledge.cue}</p></div></article>
            <section className="related-section"><div className="section-title"><span className="step-number">Q</span><div><h2>关联题目</h2><p>从不同题目场景中巩固这个知识点。</p></div></div>
              {selectedKnowledge.relatedQuestions.length ? <div className="related-question-list">{selectedKnowledge.relatedQuestions.map((item) => <button key={item.id} onClick={() => openRelatedQuestion(item)}><span className="question-sequence">{questionSequence(item)}</span><div><h3>{semanticTitle(item)}</h3><div className="related-question-meta"><span className={`mastery-badge ${item.mastery}`}>{masteryLabels[item.mastery]}</span><span className="familiarity-badge">★ {item.familiarity}</span>{[...item.analysis.services, ...item.analysis.topics].slice(0, 3).map((tag) => <span className="related-question-tag" key={tag}>{tag}</span>)}</div></div><span className="row-arrow" aria-hidden="true">→</span></button>)}</div> : <div className="empty-state compact"><p>当前没有关联题目。</p></div>}
            </section>
          </>}
        </section>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-heading"><div><p className="eyebrow">AI CONFIGURATION</p><h2 id="settings-title">自定义系统 Prompt</h2></div><button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button></div>
            <p className="modal-copy">此 Prompt 会发送给 DeepSeek。应用会额外强制英文原题保持不变，并要求所有解析使用简体中文和固定 JSON 结构。</p>
            <label htmlFor="system-prompt">系统 Prompt</label>
            <textarea id="system-prompt" className="prompt-editor" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            <div className="modal-footer"><button className="text-button reset-button" onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}>恢复默认</button><div><button className="secondary-button" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary-button" onClick={savePrompt}>保存设置</button></div></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
