import type { NextRequest } from "next/server";

const menuPlanningUrl = () => {
  const configured = process.env.MENU_PLANNING_BASE_URL || process.env.MENU_PLANNING_URL;
  if (configured) return configured.replace(/\/$/, "");
  if ((process.env.FIKA_RUNTIME_MODE || "local") === "local") return "http://localhost:3500";
  throw Object.assign(new Error("Menu Planning is not configured for this hosted runtime."), { status: 503, code: "MENU_PLANNING_URL_NOT_CONFIGURED" });
};

export async function menuPlanningJson<T>(request: NextRequest, path: string, validate: (value: unknown) => value is T, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${menuPlanningUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json", ...(init.headers || {}), ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}) },
    });
  } catch (error) {
    throw Object.assign(new Error("Menu Planning is unavailable."), { status: 503, cause: error });
  }
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { throw Object.assign(new Error("Menu Planning returned invalid JSON."), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error((body as { error?: { message?: string } })?.error?.message || `Menu Planning request failed (${response.status}).`), { status: response.status });
  if (!validate(body)) throw Object.assign(new Error("Menu Planning returned an invalid publication response."), { status: 502 });
  return body;
}

