import type { ReadPackageManifest } from "@fika/server-shared/read-package";
import { parseGrabAndGoCatalogue, type GrabAndGoCatalogue } from "@fika/server-shared/grab-and-go-catalogue";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const cpuBase = () => (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, "");
const headers = (): Record<string, string> => ({ accept: "application/json", ...(process.env.FIKA_INTERNAL_API_TOKEN ? { "x-fika-internal-token": process.env.FIKA_INTERNAL_API_TOKEN } : {}) });

async function request(path: string) {
  let response: Response;
  try { response = await fetch(`${cpuBase()}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: headers() }); }
  catch (cause) { throw Object.assign(new Error("CPU Grab & Go catalogue service is unavailable."), { status: 503, cause }); }
  recordDataAccess({ app: "delivered-in", operation: `cpu.grab-and-go.catalogue${path.includes("manifest") ? ".manifest" : ".package"}`, source: "NETWORK_UPSTREAM", dataset: "cpu-production/grab-and-go-catalogue", documents: 0, cacheResult: "BYPASS" });
  const body = await response.json().catch(() => undefined) as { manifest?: ReadPackageManifest; catalogue?: unknown; error?: { message?: string } } | undefined;
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || `CPU Grab & Go catalogue service failed (${response.status}).`), { status: response.status });
  return body || {};
}

export async function getGrabAndGoCatalogueManifest() {
  const body = await request("/api/grab-and-go/catalogue?manifest=1");
  if (!body.manifest) throw Object.assign(new Error("CPU Grab & Go catalogue manifest is invalid."), { status: 502 });
  return body.manifest;
}

export async function getGrabAndGoCataloguePackage() {
  const body = await request("/api/grab-and-go/catalogue");
  const catalogue = parseGrabAndGoCatalogue(body.catalogue);
  if (!body.manifest) throw Object.assign(new Error("CPU Grab & Go catalogue package is missing its manifest."), { status: 502 });
  return { catalogue, manifest: body.manifest } as { catalogue: GrabAndGoCatalogue; manifest: ReadPackageManifest };
}
