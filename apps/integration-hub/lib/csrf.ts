import crypto from "node:crypto";
import { sessionCookieConfig } from "./runtime-config";
export const CSRF_COOKIE = "fika_csrf";
export function newCsrfToken() { return crypto.randomBytes(32).toString("base64url"); }
export function csrfCookieOptions() { const config = sessionCookieConfig(); return { httpOnly: false, sameSite: "lax" as const, secure: config.secureCookies, path: "/", maxAge: 60 * 60, ...(config.domain ? { domain: config.domain } : {}) }; }
export function validCsrf(cookie: string | undefined, submitted: string | undefined) { if (!cookie || !submitted) return false; const left = Buffer.from(cookie); const right = Buffer.from(submitted); return left.length === right.length && crypto.timingSafeEqual(left, right); }
export function assertSameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) throw Object.assign(new Error("A same-origin request is required."), { status: 403, code: "FIKA_ORIGIN_REQUIRED" }); const configured = (process.env.FIKA_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean); const expected = configured.length ? configured : [new URL(request.url).origin]; if (!expected.includes(origin)) throw Object.assign(new Error("Request origin is not allowed."), { status: 403, code: "FIKA_ORIGIN_DENIED" }); }
