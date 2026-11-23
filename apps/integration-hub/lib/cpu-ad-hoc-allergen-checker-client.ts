import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";
import type { AdHocAllergenCheckerStatus } from "../../shared/ad-hoc-production-contract";

function cpuBase() {
  const configured = process.env.CPU_PRODUCTION_BASE_URL?.trim();
  const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
  if (!configured) {
    if (hosted) throw new Error("CPU_PRODUCTION_BASE_URL is required outside local development.");
    return "http://localhost:3400";
  }
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error("CPU_PRODUCTION_BASE_URL must be a valid URL."); }
  if (hosted && parsed.protocol !== "https:") throw new Error("CPU_PRODUCTION_BASE_URL must use HTTPS outside local development.");
  return approvedCredentialedUpstream("cpu", configured);
}

function internalHeaders() {
  const token = process.env.FIKA_INTERNAL_API_TOKEN?.trim();
  const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
  if (!token && hosted) throw new Error("FIKA_INTERNAL_API_TOKEN is required for current CPU allergen verification.");
  return { accept: "application/json", ...(token ? { "x-fika-internal-token": token } : {}) };
}

export async function currentCpuAdHocAllergenChecker(orderId: string): Promise<AdHocAllergenCheckerStatus> {
  const response = await fetch(`${cpuBase()}/api/internal/ad-hoc/allergen-checker?orderId=${encodeURIComponent(orderId)}`, { headers: internalHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
  const body = await response.json().catch(() => undefined) as AdHocAllergenCheckerStatus | undefined;
  if (!response.ok || !body || typeof body.state !== "string") throw Object.assign(new Error("The CPU allergen checker authority could not be verified."), { status: response.status || 503 });
  return body;
}

export async function currentCpuAdHocAllergenPdf(orderId: string) {
  const response = await fetch(`${cpuBase()}/api/internal/ad-hoc/allergen-checker?orderId=${encodeURIComponent(orderId)}&download=pdf`, { headers: internalHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(new Error("The current signed allergen PDF could not be opened."), { status: response.status });
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) throw Object.assign(new Error("CPU returned an invalid allergen PDF response."), { status: 502 });
  return response;
}
