import type { Actor } from "./auth";
import type { CanonicalRecord } from "./types";

export const DELIVERED_IN_PERMISSIONS = ["delivered_in.view", "delivered_in.allergens.view"] as const;
export type DeliveredInPermission = typeof DELIVERED_IN_PERMISSIONS[number];
export type DeliveredInAccess = { email: string; oplocIds: string[]; permissions: DeliveredInPermission[] };
export type DeliveredInSite = { oplocId: string; label: string };

const FIXTURE_SITE_ASSIGNMENTS: Record<string, string[]> = {
  "admin@local.fika": [],
  "reviewer@local.fika": ["oploc:46701265-15af-48f4-a230-1d27ca21bc59", "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d"],
  "viewer@local.fika": ["oploc:46701265-15af-48f4-a230-1d27ca21bc59"],
};

const KNOWN_LABELS: Record<string, string> = {
  "oploc:46701265-15af-48f4-a230-1d27ca21bc59": "Haleon",
  "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d": "FIKA Xchange",
  "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10": "One Angel Court",
  "oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c": "Commerzbank",
  "oploc:83c79eb4-4033-408c-96d7-6c496ed6f6c9": "Nesta",
  "oploc:a358ef5f-297b-4816-bbf5-7fef470e81d7": "Bridgepoint",
  "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f": "MNK",
};

const activeOplocs = (records: CanonicalRecord[]) => records.filter(record => record.entityType === "OPLOC" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && record.publicationStatus !== "withdrawn");

export function resolveDeliveredInAccess(actor: Pick<Actor, "email" | "role">, records: CanonicalRecord[] = []): { access: DeliveredInAccess; sites: DeliveredInSite[] } {
  const all = activeOplocs(records);
  const assigned = actor.role === "integration-admin" ? (all.length ? all.map(record => record.canonicalId) : Object.keys(KNOWN_LABELS)) : FIXTURE_SITE_ASSIGNMENTS[actor.email || ""] || [];
  const oplocIds = Array.from(new Set(assigned.filter(id => actor.role === "integration-admin" || all.length === 0 || all.some(record => record.canonicalId === id))));
  const labelById = new Map(all.map(record => [record.canonicalId, String(record.record.approvedName || record.canonicalId)]));
  return { access: { email: actor.email || "", oplocIds, permissions: [...DELIVERED_IN_PERMISSIONS] }, sites: oplocIds.map(oplocId => ({ oplocId, label: labelById.get(oplocId) || KNOWN_LABELS[oplocId] || oplocId })) };
}
