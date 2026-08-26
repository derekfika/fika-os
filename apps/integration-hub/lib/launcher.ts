import { hasAuthmodAdmin } from "./authmod-core/authority";
import { resolveUserAccess } from "./authmod-core/evaluator";
import type { AuthModRepository, AuthPrincipal, ApplicationRegistryEntry } from "./authmod-core";
import { isEffective } from "./authmod-core/model";

const purposes: Record<string, string> = { "integration-hub": "Data governance and integrations", "cpu-production": "Production planning and kitchen workflows", logistics: "Deliveries, collections and dispatch", "menu-planning": "Plan and publish operational menus", "hospitality-booking": "Hospitality booking management", "delivered-in": "Delivered-in production workflow", "ad-hoc-production": "One-off production requirements" };
const envKeys: Record<string, string> = { "cpu-production": "FIKA_APP_CPU_URL", logistics: "FIKA_APP_LOGISTICS_URL", "menu-planning": "FIKA_APP_MENU_PLANNING_URL", "hospitality-booking": "FIKA_APP_HOSPITALITY_URL", "delivered-in": "FIKA_APP_DELIVERED_IN_URL", "ad-hoc-production": "FIKA_APP_AD_HOC_URL" };
const defaults: Record<string, string> = { "cpu-production": "http://localhost:3400", logistics: "http://localhost:3900", "menu-planning": "http://localhost:3500", "hospitality-booking": "http://localhost:3300", "delivered-in": "http://localhost:3800", "ad-hoc-production": "http://localhost:4000" };
function appHref(appId: string) { if (appId === "integration-hub") return "/hub"; const value = process.env[envKeys[appId] || ""] || defaults[appId]; if (!value) return undefined; try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) return undefined; return url.toString(); } catch { return undefined; } }
export type LauncherApplication = { appId: string; label: string; purpose: string; href: string; available: true };
export async function buildLauncher(repository: AuthModRepository, principal: AuthPrincipal) {
  const applications: LauncherApplication[] = [];
  for (const app of (await repository.listApplications()).filter(value => value.enabled && value.launchVisible)) {
    const href = appHref(app.appId); if (!href) continue;
    const access = await resolveLauncherAppAccess(repository, principal, app);
    if (access) applications.push({ appId: app.appId, label: app.displayName, purpose: purposes[app.appId] || "FIKA OS operational application", href, available: true });
  }
  return { principal: { displayName: principal.displayName, email: principal.type === "interactive" ? principal.email : undefined, identityKind: principal.type === "interactive" ? principal.identityKind : undefined }, applications, canAdministerAuthmod: principal.type === "interactive" && await hasAuthmodAdmin(repository, principal.id) };
}
async function resolveLauncherAppAccess(repository: AuthModRepository, principal: AuthPrincipal, app: ApplicationRegistryEntry) {
  if (app.scopeModel === "none") return (await resolveUserAccess(repository, { principal, appId: app.appId })).allowed;
  const identity = principal.type === "interactive" ? await repository.getIdentity(principal.id) : undefined;
  const sites = identity ? await repository.listSiteAssignments(identity.id) : [];
  const activeSites = identity?.fullAccess && identity.identityKind === "person" ? await repository.listActiveOplocs() : await Promise.all(sites.filter(value => isEffective(value)).map(value => repository.getActiveOploc(value.oplocId)));
  for (const site of activeSites.filter(Boolean)) if ((await resolveUserAccess(repository, { principal, appId: app.appId, oplocId: site!.id })).allowed) return true;
  return false;
}
