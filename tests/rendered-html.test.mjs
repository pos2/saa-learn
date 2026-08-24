import assert from "node:assert/strict";
import test from "node:test";

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  APP_ACCESS_PASSWORD: "test-password",
  APP_SESSION_SECRET: "test-session-secret-that-is-long-enough",
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

test("server-renders the SAA Learn application shell", async () => {
  const worker = await loadWorker();
  const unauthenticated = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(unauthenticated.status, 302);
  assert.match(unauthenticated.headers.get("location") ?? "", /\/auth\/login/);

  const form = new URLSearchParams({ password: "test-password", returnTo: "/" });
  const login = await worker.fetch(new Request("http://localhost/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }), env, ctx);
  assert.equal(login.status, 303);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
  assert.match(cookie, /^saa_access=/);

  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html", cookie } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SAA Learn/);
  assert.match(html, /你的 SAA/);
  assert.match(html, /熟悉度地图/);
  assert.match(html, /学习概览/);
  assert.match(html, /题目解析/);
  assert.match(html, /我的题库/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});
