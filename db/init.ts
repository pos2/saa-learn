import { env } from "cloudflare:workers";

export function getD1() {
  if (!env.DB) throw new Error("本地数据库尚未启用，请确认 .openai/hosting.json 的 d1 为 DB。");
  return env.DB;
}

/**
 * Schema creation and upgrades are applied from the checked-in Drizzle
 * migrations during deployment. Request handlers must never run DDL: Sites
 * workers are stateless, so an in-memory initialization flag cannot prevent
 * that work from repeating on newly scheduled isolates.
 */
export async function ensureDatabase() {
  getD1();
}
