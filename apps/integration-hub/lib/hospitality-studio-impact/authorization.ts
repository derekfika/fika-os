import type { AuthModRepository, AuthPrincipal } from "../authmod-core";
import { requireCompanyHospitalityBookingAdmin } from "../hospitality-booking-authorization";
import { authoriseRotation } from "../hospitality-rotations/auth";

export async function requireStudioImpactAccess(repository: AuthModRepository, principal: AuthPrincipal) {
  await authoriseRotation(repository, principal, "Manage");
  await requireCompanyHospitalityBookingAdmin(repository, principal);
}
