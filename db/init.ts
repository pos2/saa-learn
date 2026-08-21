import { env } from "cloudflare:workers";

const statements = [
  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY NOT NULL,
    original_text TEXT NOT NULL,
    title TEXT NOT NULL,
    answer TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT DEFAULT 'confirmed' NOT NULL,
    mastery TEXT DEFAULT 'unreviewed' NOT NULL,
    familiarity INTEGER DEFAULT 0 NOT NULL,
    model TEXT,
    prompt_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS question_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    question_id TEXT NOT NULL,
    label TEXT NOT NULL,
    content TEXT,
    explanation TEXT NOT NULL,
    is_correct INTEGER DEFAULT 0 NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_points (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT NOT NULL,
    exam_cue TEXT NOT NULL,
    status TEXT DEFAULT 'candidate' NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS question_knowledge_points (
    question_id TEXT NOT NULL,
    knowledge_point_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    PRIMARY KEY(question_id, knowledge_point_id),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT DEFAULT 'candidate' NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS question_tags (
    question_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY(question_id, tag_id),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE TABLE IF NOT EXISTS ai_analysis_runs (
    id TEXT PRIMARY KEY NOT NULL,
    question_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt_snapshot TEXT NOT NULL,
    raw_response TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt_tokens INTEGER DEFAULT 0 NOT NULL,
    completion_tokens INTEGER DEFAULT 0 NOT NULL,
    reasoning_tokens INTEGER DEFAULT 0 NOT NULL,
    total_tokens INTEGER DEFAULT 0 NOT NULL,
    attempt_count INTEGER DEFAULT 1 NOT NULL,
    latency_ms INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON UPDATE no action ON DELETE set null
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions (created_at)",
  "CREATE INDEX IF NOT EXISTS idx_questions_status_updated_at ON questions (status, updated_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_question_options_question_label ON question_options (question_id, label)",
  "CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON question_options (question_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_points_normalized_name ON knowledge_points (normalized_name)",
  "CREATE INDEX IF NOT EXISTS idx_knowledge_points_status_name ON knowledge_points (status, name)",
  "CREATE INDEX IF NOT EXISTS idx_question_knowledge_points_knowledge_id ON question_knowledge_points (knowledge_point_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_kind_normalized_name ON tags (kind, normalized_name)",
  "CREATE INDEX IF NOT EXISTS idx_tags_kind_name ON tags (kind, name)",
  "CREATE INDEX IF NOT EXISTS idx_question_tags_tag_id ON question_tags (tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_question_created ON ai_analysis_runs (question_id, created_at)",
];

let initialized: Promise<void> | null = null;

export function getD1() {
  if (!env.DB) throw new Error("本地数据库尚未启用，请确认 .openai/hosting.json 的 d1 为 DB。");
  return env.DB;
}

export async function ensureDatabase() {
  if (!initialized) {
    initialized = (async () => {
      const d1 = getD1();
      await d1.prepare("PRAGMA foreign_keys = ON").run();
      for (const statement of statements) await d1.prepare(statement).run();
      try {
        await d1.prepare("ALTER TABLE questions ADD COLUMN mastery TEXT DEFAULT 'unreviewed' NOT NULL").run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
      }
      try {
        await d1.prepare("ALTER TABLE questions ADD COLUMN familiarity INTEGER DEFAULT 0 NOT NULL").run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
      }
      const analysisRunColumns = [
        "prompt_tokens INTEGER DEFAULT 0 NOT NULL",
        "completion_tokens INTEGER DEFAULT 0 NOT NULL",
        "reasoning_tokens INTEGER DEFAULT 0 NOT NULL",
        "total_tokens INTEGER DEFAULT 0 NOT NULL",
        "attempt_count INTEGER DEFAULT 1 NOT NULL",
        "latency_ms INTEGER DEFAULT 0 NOT NULL",
      ];
      for (const column of analysisRunColumns) {
        try {
          await d1.prepare(`ALTER TABLE ai_analysis_runs ADD COLUMN ${column}`).run();
        } catch (error) {
          if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
        }
      }
      await d1.prepare("CREATE INDEX IF NOT EXISTS idx_questions_mastery_updated_at ON questions (mastery, updated_at)").run();
      await d1.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}
