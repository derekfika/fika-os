/**
 * Pure, client-safe model for the Booking Services tab and the Item inspector's "where customers can order this" view (#178).
 * It derives everything from the effective published layout (site x service x category). There is no per-Item service flag.
 * Category names are identity: matched exactly, never normalised.
 */
import type { ServiceId, ServiceRule } from "@fika/server-shared/hospitality-service-layout";
import { SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import { SERVICE_LABELS, serviceRuleAt, setCategoryIncluded, type ServiceLayoutView } from "../../../lib/hospitality-catalogue-types";
import type { CatalogueRow } from "../../../lib/hospitality-catalogue-types";

export type CatalogueTab = "overview" | "manager" | "items" | "services" | "locations";
export const CATALOGUE_TABS: ReadonlyArray<{ id: CatalogueTab; label: string; hint: string }> = [
  { id: "overview", label: "Overview", hint: "Catalogue summary and actions" },
  { id: "manager", label: "Catalogue Manager", hint: "Browse services, categories and items together" },
  { id: "items", label: "Items", hint: "Products, prices and sites" },
  { id: "services", label: "Services", hint: "What each booking service offers customers" },
  { id: "locations", label: "Locations", hint: "Where each service is available" },
];
/** Context carried from an Item (or anywhere) into the Booking Services tab. */
export type ServicesContext = { oplocId?: string; serviceId?: ServiceId; category?: string; itemId?: string };

/** Counts are catalogue records and site permission, never a claim of customer orderability. */
export function managerItemCounts(rows: readonly Pick<CatalogueRow, "category" | "status" | "availableAt">[], category: string, oplocId?: string) {
  const matching = rows.filter(row => row.category === category);
  return {
    active: matching.filter(row => row.status === "active").length,
    sitePermitted: oplocId ? matching.filter(row => row.status === "active" && row.availableAt.includes(oplocId)).length : undefined,
    archived: matching.filter(row => row.status === "archived").length,
  };
}

type LayoutStored = Pick<ServiceLayoutView, "company" | "sites">;
type ItemLike = Pick<CatalogueRow, "name" | "category" | "status" | "availableAt">;

/** "Only RCoA Dining" - the exact scope a save will touch. */
export const scopePhrase = (siteLabel: string, serviceId: ServiceId) => `Only ${siteLabel} ${SERVICE_LABELS[serviceId]}`;
export const otherServices = (serviceId: ServiceId) => SERVICE_IDS.filter(id => id !== serviceId).map(id => SERVICE_LABELS[id]);

/** Active Items in a category, split by whether they are permitted at the site (only permitted ones can ever be listed there). */
export function categoryItems(rows: readonly ItemLike[], category: string, oplocId: string) {
  const inCategory = rows.filter(row => row.status === "active" && row.category === category);
  return { orderable: inCategory.filter(row => row.availableAt.includes(oplocId)), notPermitted: inCategory.filter(row => !row.availableAt.includes(oplocId)) };
}

export type GuidedChange = {
  before: string[]; after: string[]; added: string[]; removed: string[]; changed: boolean;
  source: "company" | "site"; hidden: boolean;
  /** Saving would create a new site override (nothing stored at this site for the service yet). */
  createsOverride: boolean;
  /** The result would equal the company default, which the server refuses as an override. */
  matchesCompany: boolean;
};
export function guidedChange(view: LayoutStored, oplocId: string, serviceId: ServiceId, draft: readonly string[]): GuidedChange {
  const { rule, source } = serviceRuleAt(view, oplocId, serviceId);
  const company = serviceRuleAt(view, undefined, serviceId).rule;
  const before = [...rule.categories], after = [...draft];
  const added = after.filter(c => !before.includes(c)), removed = before.filter(c => !after.includes(c));
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return { before, after, added, removed, changed: added.length > 0 || removed.length > 0, source, hidden: Boolean(rule.hidden), createsOverride: source === "company", matchesCompany: same(after, company.categories) && Boolean(rule.hidden) === Boolean(company.hidden) };
}
/** The draft rule to save: the order of existing categories is kept, new ones are appended, hidden is preserved. */
export function guidedDraft(view: LayoutStored, oplocId: string, serviceId: ServiceId, category: string, included: boolean, current?: readonly string[]): ServiceRule {
  const { rule } = serviceRuleAt(view, oplocId, serviceId);
  const next = setCategoryIncluded(current ?? rule.categories, category, included);
  // Untick then retick must not reorder: categories already in the stored rule keep their stored order, new ones follow.
  const ordered = [...rule.categories.filter(c => next.includes(c)), ...next.filter(c => !rule.categories.includes(c))];
  return { categories: ordered, ...(rule.hidden ? { hidden: true } : {}) };
}

/** Context for "Manage booking services": site and category only. The operator must pick the service; never preselect one (it could be Breakfast). */
export const manageServicesContext = (oplocId: string, category: string, itemId?: string): ServicesContext => ({ oplocId, category, ...(itemId ? { itemId } : {}) });

/** Everyday-language impact lines for the preview. */
export function impactLines(rows: readonly ItemLike[], change: GuidedChange, oplocId: string, siteLabel: string, serviceLabel: string) {
  const lines: Array<{ category: string; kind: "added" | "removed"; orderable: number; notPermitted: number; names: string[] }> = [];
  for (const [list, kind] of [[change.added, "added"], [change.removed, "removed"]] as const) for (const category of list) {
    const { orderable, notPermitted } = categoryItems(rows, category, oplocId);
    lines.push({ category, kind, orderable: orderable.length, notPermitted: notPermitted.length, names: orderable.map(r => r.name) });
  }
  return { siteLabel, serviceLabel, lines };
}
export function impactSentence(line: { category: string; kind: "added" | "removed"; orderable: number; notPermitted: number }, siteLabel: string, serviceLabel: string) {
  const n = (count: number) => `${count} item${count === 1 ? "" : "s"}`;
  const verb = line.kind === "added" ? "will appear in" : "will stop appearing in";
  const base = line.orderable === 0 ? `${line.category}: no active items are available at ${siteLabel}, so nothing will appear or disappear yet.` : `${line.category}: ${n(line.orderable)} ${verb} ${siteLabel} ${serviceLabel}.`;
  return line.notPermitted > 0 ? `${base} ${n(line.notPermitted)} in this category ${line.notPermitted === 1 ? "is" : "are"} not permitted at ${siteLabel} and stay${line.notPermitted === 1 ? "s" : ""} hidden.` : base;
}

/** Ready to save: a real change, a reason, and the scope explicitly confirmed. Server stays the authority. */
export function guidedBlocker(change: GuidedChange, reason: string, confirmed: boolean): string {
  if (!change.changed) return "Choose a category to change first.";
  if (!change.hidden && change.after.length === 0) return "A service must offer at least one category.";
  if (change.createsOverride && change.matchesCompany) return "This matches the company default, so it is not a site change.";
  if (change.source === "site" && change.matchesCompany) return "This now matches the company default. Use Clear override in All services to inherit it.";
  if (reason.trim().length < 8) return "Record a reason of at least eight characters.";
  if (!confirmed) return "Tick the box to confirm the scope.";
  return "";
}

/** For the inspector: per permitted site, the booking services whose effective rule lists the Item's category. */
export function itemServiceVisibility(view: LayoutStored | undefined, row: ItemLike, siteIds: readonly string[]) {
  if (!view) return [];
  return siteIds.map(oplocId => {
    const states = SERVICE_IDS.map(serviceId => {
      const { rule, source } = serviceRuleAt(view, oplocId, serviceId);
      return { serviceId, label: SERVICE_LABELS[serviceId], source, shown: !rule.hidden && rule.categories.includes(row.category) };
    });
    return { oplocId, shownIn: states.filter(s => s.shown), notShownIn: states.filter(s => !s.shown) };
  });
}
