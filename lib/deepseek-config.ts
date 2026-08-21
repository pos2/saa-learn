import { env } from "cloudflare:workers";

export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: "deepseek-v4-flash";
  thinking: "enabled" | "disabled";
};

export function getDeepSeekConfig(): DeepSeekConfig {
  const values = env as unknown as Record<string, string | undefined>;
  const read = (key: string) => values[key] ?? process.env[key];
  return {
    apiKey: read("DEEPSEEK_API_KEY") ?? "",
    baseUrl: read("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    thinking: read("DEEPSEEK_THINKING") === "disabled" ? "disabled" : "enabled",
  };
}
