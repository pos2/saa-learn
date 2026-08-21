export type Analysis = {
  title: string;
  answer: string;
  summary: string;
  services: string[];
  topics: string[];
  keywords: string[];
  optionNotes: { label: string; content?: string; correct: boolean; text: string }[];
  knowledge: { id?: string; title: string; body: string; cue: string }[];
};

export type KnowledgePointSummary = {
  id: string;
  title: string;
  body: string;
  cue: string;
  questionCount: number;
};

export type KnowledgePointDetail = KnowledgePointSummary & {
  relatedQuestions: SavedQuestion[];
};

export type AnalysisMeta = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  attemptCount: number;
  latencyMs: number;
};

export type SavedQuestion = {
  id: string;
  sequence?: number;
  original: string;
  title: string;
  analysis: Analysis;
  analysisRunId?: string;
  analysisMeta?: AnalysisMeta;
  mastery: "unreviewed" | "learning" | "mastered";
  familiarity: number;
  createdAt: string;
};

export const DEFAULT_SYSTEM_PROMPT = `你是一位严谨的 AWS Solutions Architect Associate 学习教练。请分析用户提供的题目：
1. 题目可能是英文；必须保留原题，不翻译或改写原题；
2. 所有解析内容必须使用简体中文，包括答案结论、逐项解释、知识点和考试线索；
3. 提取 AWS 服务、候选题型、关键词与相关知识点；
4. 说明解题线索、常见误区和适用场景；
5. 不确定时明确说明，不要编造 AWS 功能；
6. 返回符合应用约定 Schema 的结构化结果。`;
