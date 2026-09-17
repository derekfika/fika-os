import crypto from "crypto";
import path from "path";
import type { ExternalProductionMaterialisation as SharedExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { canonicalOplocId, GOVERNED_OPLOCS, oplocIdsMatch, resolveGovernedOploc } from "@fika/server-shared/governed-oplocs";
import type { DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { CANONICAL_ALLERGEN_COLUMNS, type CanonicalAllergenKey, type CanonicalAllergenMap, type OperationalAllergenState } from "../../shared/allergen-contract";
export { CANONICAL_ALLERGEN_COLUMNS, CANONICAL_ALLERGEN_KEYS, deriveNoKeyAllergens, enforceNoKeyExclusivity, isCompleteOperationalAllergenMap, normaliseOperationalAllergens, resolveNoKeyAllergenState, toggleOperationalAllergen, toCanonicalAllergenKey } from "../../shared/allergen-contract";
export type { CanonicalAllergenKey, CanonicalAllergenMap, OperationalAllergenState } from "../../shared/allergen-contract";
export { claimEvent, eventIsDue, markEventDeadLetter, markEventDelivered, markEventFailed, outboxRecord, resetEventForReplay } from "@fika/server-shared/durable-outbox";
export type { DurableDomainEvent } from "@fika/server-shared/durable-outbox";
export { GOVERNED_OPLOCS, canonicalOplocId, oplocIdsMatch, resolveGovernedOploc } from "@fika/server-shared/governed-oplocs";
export type { GovernedOploc } from "@fika/server-shared/governed-oplocs";

export function appDataPath(_appName: string, ...parts: string[]) { return path.join(/*turbopackIgnore: true*/ process.cwd(), "local-data", ...parts); }
export function createDomainEvent<T>(input: { eventType: string; sourceAggregateId: string; sourceVersion: number; occurredAt: string; correlationId?: string; causationId?: string; predecessorEventId?: string; payload: T }): DurableDomainEvent<T> { return { ...input, eventId: `${input.eventType}:${input.sourceAggregateId}:v${input.sourceVersion}`, schemaVersion: "0.1.0", delivery: { status: "pending", attempts: 0, nextAttemptAt: input.occurredAt, nextEligibleAt: input.occurredAt } }; }

export type FulfilmentRequirement = { [key: string]: unknown };
export type ExternalProductionMaterialisation = SharedExternalProductionMaterialisation;
export function productionItemId(title: string, parent = "global") { const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled"; return `sandwich:${slug(parent)}:${slug(title)}`; }
export function legacyProductionItemId(title: string) { return `sandwich:${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled"}`; }
export function stableHash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function publishedAllergenMatrixHtml(day: { dayName: string; date: string; version: number; contentHash: string; entries: Array<{ slot: string; dishName: string; allergens: Record<string, string>; mayContainNotes?: string }> }) {
  const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  const headers = CANONICAL_ALLERGEN_COLUMNS.map(([, label]) => `<th>${esc(label)}</th>`).join("");
  const rows = day.entries.map(entry => `<tr><th>${esc(entry.slot)} · ${esc(entry.dishName)}</th>${CANONICAL_ALLERGEN_COLUMNS.map(([key]) => { const state = entry.allergens[key] || "unrecorded"; return `<td class="${state}">${state === "may_contain" ? "MC" : state === "unrecorded" ? "UR" : ""}</td>`; }).join("")}<td>${esc(entry.mayContainNotes || "—")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA allergen matrix</title></head><body><h1>FIKA · ALLERGEN CHECKER</h1><p>${esc(day.dayName)} · ${esc(day.date)} · v${day.version} · ${esc(day.contentHash)}</p><table><thead><tr><th>Dish / slot</th>${headers}<th>May-contain notes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
