import type { MenuItem } from "./domain";
import type { SavedSandwich } from "./sandwich-types";

export type HostedCatalogueKind = "dish" | "sandwich";
export type HostedCatalogueRecord = {
  id: string;
  kind: HostedCatalogueKind;
  source: "menu-planning-local";
  record: MenuItem | SavedSandwich;
  centralCanonicalId?: string;
  reconciliationStatus: "unreconciled" | "reconciled" | "conflict";
  createdAt?: string;
  updatedAt?: string;
};

/** Local catalogue identities remain authoritative until an explicit human reconciliation. */
export function hostedCatalogueRecord(item: MenuItem): HostedCatalogueRecord {
  return { id: item.canonicalId, kind: "dish", source: "menu-planning-local", record: structuredClone(item), reconciliationStatus: "unreconciled", updatedAt: item.audit.at(-1)?.at };
}

/** Sandwiches are app-owned catalogue subtypes, not central canonical menu entities. */
export function hostedSandwichRecord(sandwich: SavedSandwich): HostedCatalogueRecord {
  return { id: sandwich.id, kind: "sandwich", source: "menu-planning-local", record: structuredClone(sandwich), reconciliationStatus: "unreconciled", createdAt: sandwich.createdAt, updatedAt: sandwich.updatedAt };
}
