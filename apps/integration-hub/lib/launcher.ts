import { createAuthModEvaluationContext, resolveUserAccess } from "./authmod-core/evaluator";
import type { AuthModRepository, AuthPrincipal, ApplicationRegistryEntry } from "./authmod-core";
import { isEffective } from "./authmod-core/model";

const purposes: Record<string, string> = { "integration-hub": "Data governance and integrations", "cpu-production": "Production planning and kitchen workflows", logistics: "Deliveries, collections and dispatch", "menu-planning": "Plan and publish operational menus", "hospitality-booking": "Hospitality booking management", "delivered-in": "Delivered-in production workflow", "ad-hoc-production": "One-off production requirements" };
const envKeys: Record<string, string> = { "cpu-production": "FIKA_APP_CPU_URL", logistics: "FIKA_APP_LOGISTICS_URL", "menu-planning": "FIKA_APP_MENU_PLANNING_URL", "hospitality-booking": "FIKA_APP_HOSPITALITY_URL", "delivered-in": "FIKA_APP_DELIVERED_IN_URL", "ad-hoc-production": "FIKA_APP_AD_HOC_URL" };
const defaults: Record<string, string> = { "cpu-production": "http://localhost:3400", logistics: "http://localhost:3900", "menu-planning": "http://localhost:3500", "hospitality-booking": "http://localhost:3300/hospitality/manage", "delivered-in": "http://localhost:3800", "ad-hoc-production": "http://localhost:4000" };
export function appHref(appId: string) { if (appId === "integration-hub") return "/hub"; const configured = process.env[envKeys[appId] || ""]; const value = configured || (process.env.FIKA_RUNTIME_MODE === undefined || process.env.FIKA_RUNTIME_MODE === "local" ? defaults[appId] : undefined); if (!value) return undefined; try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) return undefined; return url.toString(); } catch { return undefined; } }
export type LauncherApplication = { appId: string; label: string; purpose: string; href: string; available: true };
export async function buildLauncher(repository: AuthModRepository, principal: AuthPrincipal) {
  const context = createAuthModEvaluationContext(repository, principal);
  const applications: LauncherApplication[] = [];
  const identity = await context.identity();
  const grants = await context.grants();
  const globalAdministrator = principal.type === "interactive" && Boolean(identity && identity.identityKind === "person" && identity.status === "active" && grants.some(value => value.appId === "integration-hub" && value.resource === "authmod" && value.action === "Administer" && isEffective(value)));
  for (const app of (await repository.listApplications()).filter(value => value.enabled && value.launchVisible)) {
    const href = appHref(app.appId); if (!href) continue;
    const access = globalAdministrator || await resolveLauncherAppAccess(repository, principal, app, context);
    if (access) applications.push({ appId: app.appId, label: app.displayName, purpose: purposes[app.appId] || "FIKA OS operational application", href, available: true });
  }
  return { principal: { displayName: principal.displayName, email: principal.type === "interactive" ? principal.email : undefined, identityKind: principal.type === "interactive" ? principal.identityKind : undefined }, applications, canAdministerAuthmod: globalAdministrator };
}
async function resolveLauncherAppAccess(repository: AuthModRepository, principal: AuthPrincipal, app: ApplicationRegistryEntry, context = createAuthModEvaluationContext(repository, principal)) {
  if (app.scopeModel === "none") return (await resolveUserAccess(repository, { principal, appId: app.appId }, context)).allowed;
  const identity = await context.identity();
  const sites = await context.siteAssignments();
  // Full Access already authorises the application at organisation scope. The
  // launcher only needs to decide whether to show the card; it does not need
  // to materialise every active OPLOC just to prove that access exists.
  if (identity?.fullAccess && identity.identityKind === "person") return (await resolveUserAccess(repository, { principal, appId: app.appId }, context)).allowed;
  const activeSites = await Promise.all(sites.filter(value => isEffective(value)).map(value => context.activeOploc(value.oplocId)));
  for (const site of activeSites.filter(Boolean)) if ((await resolveUserAccess(repository, { principal, appId: app.appId, oplocId: site!.id }, context)).allowed) return true;
  return false;
}
