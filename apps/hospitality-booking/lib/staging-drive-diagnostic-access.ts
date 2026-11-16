import { hubUserFetch } from "./hub";

export const RCOA_STAGING_DIAGNOSTIC_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
type HubRead = (path: string, cookie: string | null, init?: RequestInit) => Promise<Response>;

export function stagingDriveDiagnosticAvailable(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.FIKA_RUNTIME_MODE === "staging" && env.FIREBASE_PROJECT_ID === "fika-os-dev" && env.FIKA_RCOA_OPLOC_ID === RCOA_STAGING_DIAGNOSTIC_OPLOC;
}

/** Require the existing explicit company-wide Hospitality Admin grant before returning staging ACL metadata. */
export async function requireRcoaHospitalityAdminForStagingDiagnostic(cookie: string | null, read: HubRead = hubUserFetch) {
  if (!cookie?.trim()) throw Object.assign(new Error("An authenticated Hospitality Admin session is required."), { status: 401 });
  const response = await read(`/api/hospitality-bookings?site=rcoa&oploc=${encodeURIComponent(RCOA_STAGING_DIAGNOSTIC_OPLOC)}`, cookie, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Object.assign(new Error("The existing Hospitality access check did not authorise this diagnostic."), { status: 403 });
  const body = await response.json() as { hospitalityAdminAuthority?: { source?: string; oplocId?: string } };
  const authority = body.hospitalityAdminAuthority;
  if (authority?.source !== "explicit-company-grant" || authority.oplocId !== RCOA_STAGING_DIAGNOSTIC_OPLOC) {
    throw Object.assign(new Error("An effective RCoA Hospitality Admin grant is required."), { status: 403 });
  }
}
