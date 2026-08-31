import type { ProjectedDay, ProjectedEntry } from "./projection";

export type SiteMenuSectionKey = "salads" | "hot_mains" | "sides_extras";
export type SiteMenuSection = { key: SiteMenuSectionKey; title: string; entries: ProjectedEntry[] };
export type SiteMenuArtifact = {
  artifactId: string;
  oplocId: string;
  sourceDayId: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  generatedAt: string;
  generatedBy: string;
  driveFileId: string;
  driveUrl: string;
  fileName: string;
};
export type SiteMenuState = { status: "none" | "current" | "stale" | "unavailable"; artifact?: SiteMenuArtifact };

export const SITE_MENU_SECTIONS: Array<{ key: SiteMenuSectionKey; title: string }> = [
  { key: "salads", title: "Salads" },
  { key: "hot_mains", title: "Hot mains" },
  { key: "sides_extras", title: "Sides & extras" },
];

export function siteMenuSectionForSlot(slot: string): SiteMenuSectionKey {
  const value = slot.trim().toLocaleLowerCase("en-GB");
  if (/^salad\b/.test(value)) return "salads";
  if (/hot\s+meat|hot\s+veg|vegan|cold\s+protein/.test(value)) return "hot_mains";
  return "sides_extras";
}

export function groupSiteMenuEntries(entries: ProjectedEntry[]): SiteMenuSection[] {
  const grouped = new Map<SiteMenuSectionKey, ProjectedEntry[]>();
  for (const entry of entries) {
    const key = siteMenuSectionForSlot(entry.slot);
    grouped.set(key, [...(grouped.get(key) || []), entry]);
  }
  return SITE_MENU_SECTIONS.map(section => ({ ...section, entries: grouped.get(section.key) || [] })).filter(section => section.entries.length > 0);
}

export function siteMenuState(day: Pick<ProjectedDay, "sourceDayId" | "contentHash">, artifact?: SiteMenuArtifact): SiteMenuState {
  if (!artifact) return { status: "none" };
  return { status: artifact.sourceDayId === day.sourceDayId && artifact.sourceContentHash === day.contentHash ? "current" : "stale", artifact };
}

export function siteMenuFileName(siteName: string, day: Pick<ProjectedDay, "date" | "version">) {
  const safe = siteName.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  return `Delivered-In_${safe}_${day.date}_v${day.version}_Menu`;
}
