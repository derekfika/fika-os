import type { NextRequest } from "next/server";
import { deliveredInMaintenanceAllowed } from "./maintenance-auth";
import { assertAuthorisedOploc, type SiteAccess } from "./projection";

/**
 * Who may generate a Delivered-In site menu (tablet or labels). Drive/Slides work always stays server-side.
 *
 *  1. Service automation: a valid `x-fika-internal-token` (never exposed to a browser). A token that is present but wrong is
 *     rejected outright; it does not fall back to a session.
 *  2. A manager: an authenticated FIKA session (resolved by the Integration Hub), authorised for the requested OPLOC, holding the
 *     Delivered-In `delivered_in.site_menu.generate` permission. A view-only user, a different OPLOC or no session is refused.
 */
export const SITE_MENU_GENERATE_PERMISSION = "delivered_in.site_menu.generate";

export type SiteMenuCaller = { kind: "internal"; actor: string } | { kind: "manager"; actor: string; email: string };

type Resolve = (request: NextRequest) => Promise<{ access: SiteAccess }>;

const refuse = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

export async function authorizeSiteMenuGeneration(request: NextRequest, oplocId: string, resolveAccess: Resolve): Promise<SiteMenuCaller> {
  if (request.headers.get("x-fika-internal-token")) {
    if (deliveredInMaintenanceAllowed(request)) return { kind: "internal", actor: "system:internal" };
    throw refuse(401, "DELIVERED_IN_MAINTENANCE_AUTH_REQUIRED", "The internal service credential is not valid.");
  }
  let access: SiteAccess;
  try { access = (await resolveAccess(request)).access; }
  catch (error) {
    const status = Number((error as { status?: number }).status);
    // No session, an expired session or a Hub refusal is an authentication failure; a genuine upstream outage keeps its own status.
    if (status === 401 || status === 403) throw refuse(status, "DELIVERED_IN_SESSION_REQUIRED", "Sign in to FIKA OS to generate site menus.");
    throw error;
  }
  assertAuthorisedOploc(access, oplocId); // 403 for any OPLOC outside the caller's scope
  if (!access.permissions.includes(SITE_MENU_GENERATE_PERMISSION)) throw refuse(403, "DELIVERED_IN_SITE_MENU_PERMISSION_REQUIRED", "You do not have permission to generate site menus for Delivered-In.");
  return { kind: "manager", actor: access.email, email: access.email };
}

/** Whether a resolved access grants generation for one OPLOC (used to show or hide the controls; the API enforces it independently). */
export function canGenerateSiteMenu(access: SiteAccess, oplocId: string) {
  try { assertAuthorisedOploc(access, oplocId); } catch { return false; }
  return access.permissions.includes(SITE_MENU_GENERATE_PERMISSION);
}
