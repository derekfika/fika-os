import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

export const execFile = promisify(nodeExecFile);

export const MAX_LOG_LIMIT = 500;
export const DEFAULT_LOG_MINUTES = 15;
export const DEFAULT_PROJECT = "fika-os-dev";

// Keep this map aligned with the existing staging deployment wrapper and the
// apphosting.staging.yaml origins. The public build-info endpoint is omitted
// for Hub because the app currently has no such route.
export const STAGING_APPS = Object.freeze({
  "integration-hub": {
    label: "Integration Hub",
    service: "fika-os-staging",
    baseUrl: "https://staging-os.fikacatering.com",
    urlEnv: "FIKA_UAT_INTEGRATION_HUB_URL",
    buildInfo: false,
  },
  "menu-planning": {
    label: "Menu Planning",
    service: "fika-menu-planning-staging",
    baseUrl: "https://menu-planning-staging.fikacatering.com",
    urlEnv: "FIKA_UAT_MENU_PLANNING_URL",
    buildInfo: true,
  },
  "cpu-production": {
    label: "CPU Production",
    service: "fika-cpu-production-staging",
    baseUrl: "https://cpu-staging.fikacatering.com",
    urlEnv: "FIKA_UAT_CPU_PRODUCTION_URL",
    buildInfo: true,
  },
  "delivered-in": {
    label: "Delivered-In",
    service: "fika-delivered-in-staging",
    baseUrl: "https://delivered-in-staging.fikacatering.com",
    urlEnv: "FIKA_UAT_DELIVERED_IN_URL",
    buildInfo: true,
  },
});

export const APP_NAMES = Object.freeze(["delivered-in", "cpu-production", "menu-planning", "integration-hub", "all"]);

export function selectedApps(app = "all") {
  if (app === "all") return Object.keys(STAGING_APPS);
  if (!STAGING_APPS[app]) throw new Error(`Invalid app '${app}'. Choose one of: ${APP_NAMES.join(", ")}.`);
  return [app];
}

export function appBaseUrl(app, env = process.env) {
  const config = STAGING_APPS[app];
  if (!config) throw new Error(`Unknown staging app '${app}'.`);
  return (env[config.urlEnv] || config.baseUrl).replace(/\/$/, "");
}

export function assertDate(value, option = "--service-date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${option} must be a valid YYYY-MM-DD date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${option} must be a valid calendar date.`);
  return value;
}

export function assertOploc(value) {
  if (typeof value !== "string" || !/^oploc:[A-Za-z0-9._:-]{1,180}$/.test(value)) throw new Error("--oploc must be a canonical OPLOC ID such as oploc:<stable-id>.");
  return value;
}

export function assertPositiveInteger(value, option, { max } = {}) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || (max !== undefined && Number(value) > max)) {
    throw new Error(`${option} must be an integer between 1 and ${max ?? "the allowed maximum"}.`);
  }
  return Number(value);
}

export function assertSha(value, option = "SHA") {
  if (typeof value !== "string" || !/^[0-9a-f]{7,64}$/i.test(value)) throw new Error(`${option} must be a hexadecimal commit SHA.`);
  return value.toLowerCase();
}

export function parseIsoTimestamp(value, option = "--since") {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) throw new Error(`${option} must be an ISO timestamp.`);
  return parsed.toISOString();
}

export function loggingLiteral(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function mondayOf(value) {
  const date = new Date(`${assertDate(value)}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  const date = new Date(`${assertDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function requestId(prefix = "fika-uat") {
  return `${prefix}-${randomUUID()}`;
}

export function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/(?:cookie|set-cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
      .replace(/(?:ya29\.|1\/|AIza|gh[pousr]_)[A-Za-z0-9_\-/+=.]{12,}/g, "[redacted-token]")
      .slice(0, 4000);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(cookie|authorization|set-cookie|access_token|refresh_token)$/i.test(key)).map(([key, item]) => [key, redact(item)]));
  return value;
}

export function cookieFrom(env = process.env) {
  return env.FIKA_UAT_COOKIE?.trim() || undefined;
}

export async function getLocalGitSha({ exec = execFile, cwd = process.cwd() } = {}) {
  try {
    const result = await exec("git", ["rev-parse", "HEAD"], { cwd, windowsHide: true });
    const sha = String(result.stdout || "").trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchJson(url, { cookie, fetchImpl = globalThis.fetch, timeoutMs = 15000, requestId: id } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json", "x-request-id": id || requestId() };
    if (cookie) headers.cookie = cookie;
    const response = await fetchImpl(url, { method: "GET", headers, cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: { code: "INVALID_JSON", message: "The endpoint returned invalid JSON." } }; }
    return { ok: response.ok, status: response.status, body: redact(body), requestId: headers["x-request-id"], url };
  } catch (error) {
    return { ok: false, status: 0, body: { error: { code: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", message: redact(error instanceof Error ? error.message : String(error)) } }, requestId: id, url };
  } finally {
    clearTimeout(timeout);
  }
}

export function unavailableSource(app, response, guidance = "") {
  const error = response?.body?.error || {};
  return { available: false, source: app, status: response?.status || null, code: error.code || (response?.status === 401 ? "AUTH_REQUIRED" : "SOURCE_UNAVAILABLE"), message: error.message || guidance || "The source could not be queried.", requestId: response?.requestId };
}
