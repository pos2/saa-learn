import { DEFAULT_SYSTEM_PROMPT } from "../lib/domain";
import { ensureDatabase, getD1 } from "./init";

export async function getSetting(key: string) {
  await ensureDatabase();
  const row = await getD1().prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  if (row) return row.value;
  return key === "system_prompt" ? DEFAULT_SYSTEM_PROMPT : "";
}

export async function setSetting(key: string, value: string) {
  await ensureDatabase();
  await getD1().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, value, new Date().toISOString()).run();
}
