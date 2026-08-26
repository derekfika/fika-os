import crypto from "node:crypto";
import { sessionCookieConfig } from "./runtime-config";
export const CSRF_COOKIE = "fika_csrf";
export function newCsrfToken() { return crypto.randomBytes(32).toString("base64url"); }
export function csrfCookieOptions() { const config = sessionCookieConfig(); return { httpOnly: false, sameSite: "lax" as const, secure: config.secureCookies, path: "/", maxAge: 60 * 60, ...(config.domain ? { domain: config.domain } : {}) }; }
export function validCsrf(cookie: string | undefined, submitted: string | undefined) { if (!cookie || !submitted) return false; const left = Buffer.from(cookie); const right = Buffer.from(submitted); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function forwardedOrigin(request: Request) {
  if ((process.env.FIKA_RUNTIME_MODE || "local") === "local") return undefined;
  const proto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  if (!proto || !host || !["http", "https"].includes(proto) || /[\s\\/]/.test(host)) return undefined;
  try { return new URL(`${proto}://${host}`).origin; } catch { return undefined; }
}
export function assertSameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) throw Object.assign(new Error("A same-origin request is required."), { status: 403, code: "FIKA_ORIGIN_REQUIRED" }); const configured = (process.env.FIKA_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean); const expected = configured.length ? configured : [forwardedOrigin(request) || new URL(request.url).origin]; if (!expected.includes(origin)) throw Object.assign(new Error("Request origin is not allowed."), { status: 403, code: "FIKA_ORIGIN_DENIED" }); }
