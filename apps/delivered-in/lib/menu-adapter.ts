import { MenuArtifactError, allergensFromStates, menuSiteKeyForOploc, type NormalizedMenu } from "@fika/server-shared/menu-artifact";
import type { ProjectedDay, Site } from "./projection";
import { groupSiteMenuEntries, siteMenuFileName } from "./site-menu";

type CpuLineage = { releaseId?: string; releaseVersion?: string; contentHash?: string };

/** Site key used to pick a shared menu template, or undefined when the site has none. */
export function deliveredInMenuSiteKey(site: Site) { return menuSiteKeyForOploc(site.oplocId); }

/**
 * Delivered-In projected day -> normalized menu.
 *
 * Delivered-In's semantic unit is one menu per site per service day, grouped
 * into the existing Salads / Hot mains / Sides sections. The input must be the
 * authoritative current projection: withdrawn and superseded days are never
 * projected, and callers only generate after CPU has signed (the manual route
 * checks the signed review; the CPU release event carries the signed packet).
 * The allergen-safety state is deliberately NOT a guard here: after a revoke it
 * is `revoked_pending` until this very regeneration publishes the new release.
 * What this adapter does refuse is any dish whose allergens are unrecorded or
 * whose evidence is not confirmed, so a dish is never printed as clear by default.
 */
export function deliveredInMenuFromDay(day: ProjectedDay, site: Site): NormalizedMenu {
  const siteKey = deliveredInMenuSiteKey(site);
  if (!siteKey) throw new MenuArtifactError("MENU_TEMPLATE_SITE_UNSUPPORTED", `No shared menu template is defined for ${site.label}.`, 422);
  const sections = groupSiteMenuEntries(day.entries).map(section => ({
    key: section.key,
    label: section.title,
    items: section.entries.map(entry => {
      if (entry.allergenEvidenceStatus && entry.allergenEvidenceStatus !== "confirmed") throw new MenuArtifactError("MENU_ALLERGENS_UNCONFIRMED", `Allergen evidence for "${entry.dishName}" is ${entry.allergenEvidenceStatus}; the menu cannot be printed.`, 409);
      const { contains, mayContain, unrecorded } = allergensFromStates(entry.allergens);
      if (unrecorded.length) throw new MenuArtifactError("MENU_ALLERGENS_UNRECORDED", `"${entry.dishName}" has unrecorded allergens (${unrecorded.join(", ")}); a menu cannot be printed until they are recorded.`, 409);
      return { id: entry.sourceEntryId, name: entry.dishName, contains, mayContain };
    }),
  }));
  const release = (day as ProjectedDay & { sourceLineage?: { cpu?: CpuLineage } }).sourceLineage?.cpu;
  return {
    siteKey,
    siteLabel: site.label,
    oplocId: site.oplocId,
    serviceDate: day.date,
    title: "MENU",
    sections,
    fileName: siteMenuFileName(site.label, day),
    source: {
      workflow: "delivered-in",
      // Stable site+day identity; each published version/release is a distinct revision of it.
      id: `${site.oplocId}:${day.sourceDayId}`,
      version: day.version,
      revisionStamp: [day.contentHash, release?.releaseId || day.allergenSafety?.releaseVersion || "", release?.contentHash || ""].join("|"),
    },
  };
}
