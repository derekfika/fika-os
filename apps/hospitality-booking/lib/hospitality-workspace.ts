import type { PortalSiteKey } from "./portal-sites";

export type HospitalitySurface = "booking" | "operations";
export type HospitalitySurfaceAccess = {
  bookingPlatform: boolean;
  operationsDashboard: boolean;
};
export type HospitalityWorkspaceSite = {
  id: string;
  label: string;
  active: boolean;
  portalSiteKey: PortalSiteKey;
};

export type WorkspaceEntry =
  | { kind: "zero-access" }
  | { kind: "unauthorised-oploc"; oplocId: string }
  | { kind: "unauthorised-surface"; surface: HospitalitySurface }
  | { kind: "choose"; selectedOplocId?: string }
  | { kind: "destination-choice"; selectedOplocId: string }
  | { kind: "surface"; oplocId: string; surface: HospitalitySurface };

export function parseHospitalitySurface(value: string | null | undefined): HospitalitySurface | undefined {
  if (value === "booking" || value === "booking-platform") return "booking";
  if (value === "operations" || value === "operations-dashboard" || value === "dashboard") return "operations";
  return undefined;
}

export function hospitalityWorkspacePath(oplocId: string, surface: HospitalitySurface) {
  return `/workspace?oploc=${encodeURIComponent(oplocId)}&surface=${surface}`;
}

function authorisedSurfaceList(access: HospitalitySurfaceAccess) {
  return [
    access.bookingPlatform ? "booking" : undefined,
    access.operationsDashboard ? "operations" : undefined,
  ].filter((value): value is HospitalitySurface => Boolean(value));
}

export function resolveWorkspaceEntry(input: {
  sites: readonly HospitalityWorkspaceSite[];
  explicitOplocId?: string | null;
  requestedSiteKey?: string | null;
  rememberedOplocId?: string | null;
  requestedSurface?: string | null;
  surfaces: HospitalitySurfaceAccess;
}): WorkspaceEntry {
  if (!input.sites.length) return { kind: "zero-access" };

  if (input.explicitOplocId) {
    if (!input.sites.some((site) => site.id === input.explicitOplocId)) {
      return { kind: "unauthorised-oploc", oplocId: input.explicitOplocId };
    }
    const surface = parseHospitalitySurface(input.requestedSurface) || "operations";
    if (!input.surfaces[surface === "booking" ? "bookingPlatform" : "operationsDashboard"]) {
      return { kind: "unauthorised-surface", surface };
    }
    return {
      kind: "surface",
      oplocId: input.explicitOplocId,
      // `/manage?oploc=...` is an established dashboard deep link.
      surface,
    };
  }

  const selectedOplocId = input.requestedSiteKey
    ? input.sites.find((site) => site.portalSiteKey === input.requestedSiteKey)?.id
    : undefined;
  const remembered = input.rememberedOplocId && input.sites.some((site) => site.id === input.rememberedOplocId)
    ? input.rememberedOplocId
    : undefined;
  const preselectedOplocId = selectedOplocId || remembered;
  const surfaces = authorisedSurfaceList(input.surfaces);

  if (input.sites.length === 1 && surfaces.length === 1) {
    return { kind: "surface", oplocId: input.sites[0].id, surface: surfaces[0] };
  }
  if (input.sites.length === 1) {
    return { kind: "destination-choice", selectedOplocId: input.sites[0].id };
  }
  return { kind: "choose", ...(preselectedOplocId ? { selectedOplocId: preselectedOplocId } : {}) };
}
