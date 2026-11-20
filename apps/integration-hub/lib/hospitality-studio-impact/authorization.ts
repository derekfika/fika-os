import type { AuthModRepository, AuthPrincipal } from "../authmod-core";
import { isStudioAuthHubRequestHost } from "../authmod-core/hospitality-studio-admission";
import { requireCompanyHospitalityBookingAdmin } from "../hospitality-booking-authorization";
import { authoriseRotation } from "../hospitality-rotations/auth";
import { sessionCookieConfig } from "../runtime-config";

export function studioImpactMode(host: string | null, env = process.env) {
  const runtime = sessionCookieConfig(env);
  const loopback = /^(?:localhost|127\.0\.0\.1):\d+$/;
  if (runtime.mode === "local" && runtime.projectId === "demo-fika-os" &&
      loopback.test(host ?? "") && loopback.test(env.FIRESTORE_EMULATOR_HOST ?? "")) return "local";
  if (runtime.mode === "staging" && runtime.projectId === "fika-os-dev" &&
      runtime.domain === ".fikacatering.com" && isStudioAuthHubRequestHost(host)) return "staging";
}

export async function requireStudioImpactAccess(
  repository: AuthModRepository, principal: AuthPrincipal, hasStagingStudioManage?: () => Promise<boolean>,
) {
  if (hasStagingStudioManage) {
    if (!await hasStagingStudioManage()) {
      throw Object.assign(new Error("Studio management access is required."), { status: 403, code: "STUDIO_ACCESS_DENIED" });
    }
  } else await authoriseRotation(repository, principal, "Manage");
  await requireCompanyHospitalityBookingAdmin(repository, principal);
}
