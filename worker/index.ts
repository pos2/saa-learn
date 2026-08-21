/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_ACCESS_PASSWORD?: string;
  APP_SESSION_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const AUTH_COOKIE = "saa_access";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const textEncoder = new TextEncoder();

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://saa-learn.local");
    if (url.origin !== "https://saa-learn.local" || url.pathname.startsWith("/auth/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function base64Url(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function createSession(secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const token = readCookie(request, AUTH_COOKIE);
  if (!token) return false;
  const [version, expiresAtText, signature, ...rest] = token.split(".");
  if (version !== "v1" || !expiresAtText || !signature || rest.length) return false;
  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  return secureEqual(signature, await hmac(`${version}.${expiresAtText}`, secret));
}

function sessionCookie(value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function loginPage(returnTo: string, error = false): Response {
  const destination = escapeHtml(returnTo);
  const errorMessage = error
    ? '<p class="error" role="alert">访问密码不正确，请重新输入。</p>'
    : "";
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>访问 SAA Learn</title><style>
:root{color-scheme:light;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#17221f;background:#f5f7f2}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 80% 12%,#eef7bd 0,transparent 32%),#f5f7f2}
.card{width:min(440px,100%);padding:38px;border:1px solid #d8e0da;border-radius:24px;background:rgba(255,255,255,.94);box-shadow:0 24px 70px rgba(26,55,45,.12)}
.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;color:#fff;background:#173c34;font:700 22px Georgia,serif}
h1{margin:28px 0 10px;font-size:30px;letter-spacing:-.04em}p{margin:0;color:#697672;font-size:14px;line-height:1.7}
label{display:block;margin:28px 0 8px;color:#394842;font-size:12px;font-weight:700}input{width:100%;height:52px;padding:0 15px;border:1px solid #ccd7d0;border-radius:12px;background:#fff;font-size:18px;outline:none}input:focus{border-color:#73882b;box-shadow:0 0 0 4px rgba(171,198,55,.18)}
button{width:100%;height:50px;margin-top:14px;border:0;border-radius:12px;color:#173c34;background:#d7f05d;font-size:15px;font-weight:800;cursor:pointer}.error{margin-top:16px;color:#a13e32;font-size:13px}
.note{margin-top:18px;font-size:11px;color:#8a9591}
</style></head><body><main class="card"><div class="mark">S</div><h1>SAA Learn</h1><p>这是受保护的个人学习空间。请输入访问密码继续。</p>${errorMessage}
<form method="post" action="/auth/login"><input type="hidden" name="returnTo" value="${destination}"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">进入学习空间</button></form>
<p class="note">在此设备登录后，30 天内无需重复输入。</p></main></body></html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

function unauthorized(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || !request.headers.get("accept")?.includes("text/html")) {
    return Response.json({ error: "请先输入访问密码" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const returnTo = `${url.pathname}${url.search}`;
  return Response.redirect(`${url.origin}/auth/login?return_to=${encodeURIComponent(returnTo)}`, 302);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const accessPassword = env?.APP_ACCESS_PASSWORD ?? process.env.APP_ACCESS_PASSWORD;
    const sessionSecret = env?.APP_SESSION_SECRET ?? process.env.APP_SESSION_SECRET;

    if (!accessPassword || !sessionSecret) {
      return new Response("访问保护尚未配置。", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/auth/login") {
      const returnTo = safeReturnTo(url.searchParams.get("return_to"));
      if (request.method === "GET") {
        if (await hasValidSession(request, sessionSecret)) return Response.redirect(new URL(returnTo, url.origin), 302);
        return loginPage(returnTo);
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const password = String(form.get("password") ?? "");
        const formReturnTo = safeReturnTo(String(form.get("returnTo") ?? "/"));
        if (!(await secureEqual(password, accessPassword))) return loginPage(formReturnTo, true);
        const token = await createSession(sessionSecret);
        return new Response(null, {
          status: 303,
          headers: {
            location: formReturnTo,
            "set-cookie": sessionCookie(token, request, SESSION_MAX_AGE_SECONDS),
            "cache-control": "no-store",
          },
        });
      }
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
    }

    if (url.pathname === "/auth/logout") {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/auth/login",
          "set-cookie": sessionCookie("", request, 0),
          "cache-control": "no-store",
        },
      });
    }

    if (!(await hasValidSession(request, sessionSecret))) return unauthorized(request);

    if (url.pathname === "/_vinext/image" && env) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env as Env, ctx);
  },
};

export default worker;
