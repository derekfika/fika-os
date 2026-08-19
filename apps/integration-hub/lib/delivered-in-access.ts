import type { Actor } from "./auth";
import type { CanonicalRecord } from "./types";
import { GOVERNED_OPLOC_BY_ID, GOVERNED_OPLOCS } from "../../shared/governed-oplocs";

export const DELIVERED_IN_PERMISSIONS = ["delivered_in.view", "delivered_in.allergens.view"] as const;
export type DeliveredInPermission = typeof DELIVERED_IN_PERMISSIONS[number];
export type DeliveredInAccess = { email: string; oplocIds: string[]; permissions: DeliveredInPermission[] };
export type DeliveredInSite = { oplocId: string; label: string };

const FIXTURE_SITE_ASSIGNMENTS: Record<string, string[]> = {
  "admin@local.fika": [],
  "reviewer@local.fika": ["oploc:46701265-15af-48f4-a230-1d27ca21bc59", "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d"],
  "viewer@local.fika": ["oploc:46701265-15af-48f4-a230-1d27ca21bc59"],
};

const activeOplocs = (records: CanonicalRecord[]) => records.filter(record => record.entityType === "OPLOC" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && record.publicationStatus !== "withdrawn");

export function resolveDeliveredInAccess(actor: Pick<Actor, "email" | "role">, records: CanonicalRecord[] = []): { access: DeliveredInAccess; sites: DeliveredInSite[] } {
  const all = activeOplocs(records);
  const assigned = actor.role === "integration-admin" ? (all.length ? all.map(record => record.canonicalId) : GOVERNED_OPLOCS.map(oploc => oploc.id)) : FIXTURE_SITE_ASSIGNMENTS[actor.email || ""] || [];
  const oplocIds = Array.from(new Set(assigned.filter(id => actor.role === "integration-admin" || all.length === 0 || all.some(record => record.canonicalId === id))));
  const labelById = new Map(all.map(record => [record.canonicalId, String(record.record.approvedName || record.canonicalId)]));
  return { access: { email: actor.email || "", oplocIds, permissions: [...DELIVERED_IN_PERMISSIONS] }, sites: oplocIds.map(oplocId => ({ oplocId, label: labelById.get(oplocId) || GOVERNED_OPLOC_BY_ID.get(oplocId)?.label || oplocId })) };
}
