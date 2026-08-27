import crypto from "node:crypto";
import path from "node:path";

export const CANONICAL_ALLERGEN_KEYS = ["no_key_allergens", "peanuts", "tree_nuts", "gluten", "sesame", "molluscs", "fish", "soya", "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites"] as const;
export type CanonicalAllergenKey = (typeof CANONICAL_ALLERGEN_KEYS)[number];
export type OperationalAllergenState = "clear" | "contains" | "may_contain";
export type CanonicalAllergenMap = Record<string, OperationalAllergenState>;
export const CANONICAL_ALLERGEN_COLUMNS = [["no_key_allergens", "No key allergens"], ["peanuts", "Peanuts"], ["tree_nuts", "Tree nuts"], ["gluten", "Gluten"], ["sesame", "Sesame"], ["molluscs", "Molluscs"], ["fish", "Fish"], ["soya", "Soya"], ["celery", "Celery"], ["shellfish", "Shellfish"], ["eggs", "Eggs"], ["milk", "Milk"], ["mustard", "Mustard"], ["lupin", "Lupin"], ["sulphites", "Sulphites"]] as const satisfies ReadonlyArray<readonly [CanonicalAllergenKey, string]>;
const legacy: Record<string, CanonicalAllergenKey> = { noKeyAllergens: "no_key_allergens", otherNuts: "tree_nuts" };
export function toCanonicalAllergenKey(key: string) { return (CANONICAL_ALLERGEN_KEYS as readonly string[]).includes(key) ? key as CanonicalAllergenKey : legacy[key]; }
export function enforceNoKeyExclusivity(input: CanonicalAllergenMap): CanonicalAllergenMap { const result = { ...input }; if (result.no_key_allergens && result.no_key_allergens !== "clear") for (const key of CANONICAL_ALLERGEN_KEYS) if (key !== "no_key_allergens") result[key] = "clear"; else if (CANONICAL_ALLERGEN_KEYS.some(key => key !== "no_key_allergens" && result[key] && result[key] !== "clear")) result.no_key_allergens = "clear"; return result; }
export function toggleOperationalAllergen(current: CanonicalAllergenMap, key: CanonicalAllergenKey): CanonicalAllergenMap { const state = current[key] || "clear"; return enforceNoKeyExclusivity({ ...current, [key]: state === "clear" ? "contains" : state === "contains" ? "may_contain" : "clear" }); }

export type GovernedOploc = { id: string; label: string };
export const GOVERNED_OPLOCS: readonly GovernedOploc[] = [
  ["oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b", "Haleon"], ["oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d", "FIKA Xchange"], ["oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", "One Angel Court"], ["oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c", "Commerzbank"], ["oploc:83c79eb4-4033-408c-96d7-6c496ed6f6c9", "Nesta"], ["oploc:a358ef5f-297b-4816-bbf5-7fef470e81d7", "Bridgepoint"], ["oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", "MNK"], ["oploc:4e7b2838-95de-49c8-bf04-55200841d4cb", "Wise"],
].map(([id, label]) => ({ id, label }));
const aliases: Record<string, GovernedOploc> = Object.fromEntries([
  ...GOVERNED_OPLOCS.flatMap(item => [[item.label.toLowerCase(), item], [item.id, item]]),
  ["haleon", GOVERNED_OPLOCS[0]], ["haelon", GOVERNED_OPLOCS[0]], ["x", GOVERNED_OPLOCS[1]], ["fika xchange", GOVERNED_OPLOCS[1]],
  ["nesta", GOVERNED_OPLOCS[4]], ["comm", GOVERNED_OPLOCS[3]], ["commerce", GOVERNED_OPLOCS[3]], ["commerzbank", GOVERNED_OPLOCS[3]],
  ["angel", GOVERNED_OPLOCS[2]], ["angeel", GOVERNED_OPLOCS[2]], ["one angel court", GOVERNED_OPLOCS[2]], ["bp", GOVERNED_OPLOCS[5]], ["bridgepoint", GOVERNED_OPLOCS[5]], ["mk", GOVERNED_OPLOCS[6]], ["mnk", GOVERNED_OPLOCS[6]],
  ["oploc:46701265-15af-48f4-a230-1d27ca21bc59", GOVERNED_OPLOCS[0]],
]);
export function resolveGovernedOploc(destinationId?: string, destinationLabel?: string) { return (destinationId && aliases[destinationId]) || aliases[String(destinationLabel || "").trim().toLowerCase()]; }

export function appDataPath(_appName: string, ...parts: string[]) { return path.join(/*turbopackIgnore: true*/ process.cwd(), "local-data", ...parts); }
export type DurableDomainEvent<T = unknown> = { eventId: string; eventType: string; sourceAggregateId: string; sourceVersion: number; occurredAt: string; correlationId?: string; causationId?: string; schemaVersion: string; payload: T; delivery: { status: "pending" | "delivered" | "failed"; attempts: number; nextAttemptAt?: string; lastAttemptAt?: string; deliveredAt?: string; lastError?: string; claimId?: string; claimedAt?: string } };
export function createDomainEvent<T>(input: { eventType: string; sourceAggregateId: string; sourceVersion: number; occurredAt: string; correlationId?: string; causationId?: string; payload: T }): DurableDomainEvent<T> { return { ...input, eventId: `${input.eventType}:${input.sourceAggregateId}:v${input.sourceVersion}`, schemaVersion: "0.1.0", delivery: { status: "pending", attempts: 0 } }; }
export function eventIsDue(event: DurableDomainEvent, at = new Date()) { return event.delivery.status !== "delivered" && (!event.delivery.nextAttemptAt || new Date(event.delivery.nextAttemptAt) <= at) && !(event.delivery.claimedAt && at.getTime() - new Date(event.delivery.claimedAt).getTime() < 60000); }
export function claimEvent<T>(event: DurableDomainEvent<T>, claimId: string, at: string) { return { ...event, delivery: { ...event.delivery, claimId, claimedAt: at } }; }
export function markEventDelivered<T>(event: DurableDomainEvent<T>, at: string) { return { ...event, delivery: { ...event.delivery, status: "delivered" as const, deliveredAt: at, lastAttemptAt: at, claimId: undefined, claimedAt: undefined } }; }
export function markEventFailed<T>(event: DurableDomainEvent<T>, error: unknown, at: string) { return { ...event, delivery: { ...event.delivery, status: "failed" as const, attempts: event.delivery.attempts + 1, lastAttemptAt: at, nextAttemptAt: new Date(Date.parse(at) + 30000).toISOString(), lastError: error instanceof Error ? error.message : String(error), claimId: undefined, claimedAt: undefined } }; }

export type FulfilmentRequirement = { [key: string]: unknown };
export type ExternalProductionMaterialisation = { sourceDomain: "grab-and-go" | "menu-planning"; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; sourcePublicationDayId?: string; destinationOplocId: string; destinationLabel?: string; serviceDate: string; requiredBy?: string; serviceWindow?: { startTime: string; endTime?: string }; status: "submitted" | "published" | "amended" | "cancelled" | "withdrawn"; lines: Array<{ sourceLineId: string; canonicalItemId?: string; itemName: string; quantity: number; unit: string; workstream?: "delivered_in"; approvedAllergenSnapshot?: { allergens: Record<string, string>; mayContainNotes?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string } }> };
export function productionItemId(title: string, parent = "global") { const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled"; return `sandwich:${slug(parent)}:${slug(title)}`; }
export function legacyProductionItemId(title: string) { return `sandwich:${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled"}`; }
export function stableHash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function publishedAllergenMatrixHtml(day: { dayName: string; date: string; version: number; contentHash: string; entries: Array<{ slot: string; dishName: string; allergens: Record<string, string>; mayContainNotes?: string }> }) {
  const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  const headers = CANONICAL_ALLERGEN_COLUMNS.map(([, label]) => `<th>${esc(label)}</th>`).join("");
  const rows = day.entries.map(entry => `<tr><th>${esc(entry.slot)} · ${esc(entry.dishName)}</th>${CANONICAL_ALLERGEN_COLUMNS.map(([key]) => `<td class="${entry.allergens[key] || "clear"}">${entry.allergens[key] === "may_contain" ? "MC" : ""}</td>`).join("")}<td>${esc(entry.mayContainNotes || "—")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA allergen matrix</title></head><body><h1>FIKA · ALLERGEN CHECKER</h1><p>${esc(day.dayName)} · ${esc(day.date)} · v${day.version} · ${esc(day.contentHash)}</p><table><thead><tr><th>Dish / slot</th>${headers}<th>May-contain notes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
