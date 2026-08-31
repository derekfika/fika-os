import type { ProjectedDay, ProjectedEntry } from "./projection";
import type { SiteMenuState } from "./site-menu";

export type DeliveredInProjectionState = {
  freshness: "current" | "stale";
  completeness: "complete" | "partial" | "missing" | "unavailable";
  menu: "present" | "empty" | "missing" | "unavailable";
  cpu: "present" | "pending" | "missing" | "unavailable";
  exceptions: Array<{ code: string; source: "menu-planning" | "integration-hub" | "cpu-production" | "delivered-in"; message: string }>;
};

export type DeliveredInProjectionEntry = Omit<ProjectedEntry, "allergens"> & { allergens: Record<string, "clear" | "contains" | "may_contain" | "unrecorded"> };
export type DeliveredInDayProjection = Omit<ProjectedDay, "entries" | "siteMenu"> & {
  projectionId: string;
  projectionVersion: number;
  contractVersion: "delivered-in.day.v1";
  oplocId: string;
  oplocLabel: string;
  serviceDate: string;
  entries: DeliveredInProjectionEntry[];
  siteMenu: SiteMenuState & { status: "none" | "current" | "stale" | "unavailable" };
  sourceLineage: {
    menu: { publicationId: string; publicationDayId: string; sourceDayId: string; version: number; contentHash: string };
    cpu: {
      orderIds: string[];
      updatedAt?: string;
      packageVersion?: number;
      contentHash?: string;
      sourceVersion?: string;
      contractVersion?: string;
      sourceCompleteness?: "complete" | "partial";
      sourceStatus?: "current" | "partial" | "valid_empty";
      generatedAt?: string;
    };
    deliveredIn: { siteMenuArtifactId?: string; generatedAt: string };
  };
  generatedAt: string;
  state: DeliveredInProjectionState;
};

export function projectionId(oplocId: string, serviceDate: string) {
  return `delivered-in:${oplocId}:${serviceDate}`;
}

export function withProjectionFailure(projection: DeliveredInDayProjection, message: string, source: DeliveredInProjectionState["exceptions"][number]["source"]): DeliveredInDayProjection {
  return {
    ...projection,
    state: {
      ...projection.state,
      freshness: "stale",
      completeness: "unavailable",
      exceptions: [...projection.state.exceptions, { code: "SOURCE_UNAVAILABLE", source, message }],
    },
  };
}
