"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { RollingSnapshot, RollingEntry } from "@/lib/rolling-menu-types";
import { ROLLING_SLOTS } from "@/lib/rolling-menu-types";
export type Dish = { id: string; name: string; category?: string; description?: string; usage?: string[]; allergenEvidence?: Array<{ allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown" }>; mayContainReviewed?: boolean };
export type PublicationDayState = { currentPublicationDayId?: string; currentVersion?: number; currentContentHash?: string; hasCurrentPublication: boolean; hasUnpublishedChanges: boolean; legacy: boolean; status: "published" | "draft" | "legacy" };
const titleCase = (value: string) => value.trim().toLocaleLowerCase().replace(/(^|[\s\-/&])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
const weekCache = new Map<string, { snapshot: RollingSnapshot; publicationState: Record<string, PublicationDayState> }>();
let catalogueCache: Promise<Dish[]> | undefined;
const readJson = async (response: Response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error?.message || `Menu could not be loaded (HTTP ${response.status}).`); return body; };
const loadCatalogue = () => catalogueCache ||= fetch("/api/catalogue", { cache: "no-store" }).then(readJson).then(body => (body.entries || []).map((entry: Record<string, unknown>) => { const item = entry.item as Record<string, unknown> | undefined; return { id: String(entry.id), name: titleCase(String(entry.displayName ?? entry.name ?? "")), category: entry.category ? String(entry.category) : undefined, subcategory: entry.subcategory ? String(entry.subcategory) : undefined, description: item?.description ? String(item.description) : undefined, allergenEvidence: Array.isArray(item?.allergenEvidence) ? item.allergenEvidence as Dish["allergenEvidence"] : [], mayContainReviewed: item?.mayContainReviewed === true }; }));
export function useRollingData() {
  const [snapshot, setSnapshot] = useState<RollingSnapshot>(); const [weeks, setWeeks] = useState<Array<{ id: string; weekCommencing: string }>>([]); const weeksRef = useRef(weeks); const [dishes, setDishes] = useState<Dish[]>([]); const [publicationState, setPublicationState] = useState<Record<string, PublicationDayState>>({}); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const params = useSearchParams(); const requestedWeek = params.get("week");
  const load = useCallback(async (weekId?: string) => { try {
    const availableWeeks = weeksRef.current;
    const target = weekId || (requestedWeek ? availableWeeks.find(item => item.id === requestedWeek || item.weekCommencing === requestedWeek)?.id : undefined);
    const cached = target ? weekCache.get(target) : undefined;
    if (cached) { setSnapshot(cached.snapshot); setPublicationState(cached.publicationState); setError(""); }
    const query = target ? `?weekId=${encodeURIComponent(target)}` : "";
    const body = await readJson(await fetch(`/api/rolling-menu${query}`, { cache: "no-store" }));
    const next = { snapshot: body.snapshot, publicationState: body.publicationState || {} }; if (next.snapshot?.week?.id) weekCache.set(next.snapshot.week.id, next); setError(""); setSnapshot(next.snapshot); weeksRef.current = body.weeks || availableWeeks; setWeeks(weeksRef.current); setPublicationState(next.publicationState);
    const index = (body.weeks || availableWeeks).findIndex((item: { id: string }) => item.id === next.snapshot?.week?.id); for (const neighbor of [(body.weeks || availableWeeks)[index - 1], (body.weeks || availableWeeks)[index + 1]]) if (neighbor && !weekCache.has(neighbor.id)) void fetch(`/api/rolling-menu?weekId=${encodeURIComponent(neighbor.id)}`, { cache: "no-store" }).then(readJson).then(prefetched => { if (prefetched.snapshot?.week?.id) weekCache.set(prefetched.snapshot.week.id, { snapshot: prefetched.snapshot, publicationState: prefetched.publicationState || {} }); }).catch(() => undefined);
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Menu could not be loaded."); } }, [requestedWeek]);
  useEffect(() => { void load(requestedWeek || undefined); }, [load, requestedWeek]);
  useEffect(() => { void loadCatalogue().then(setDishes).catch((cause: Error) => setError(cause.message)); }, []);
  const command = useCallback(async (action: string, extra: Record<string, unknown> = {}) => { setMessage("Saving…"); const response = await fetch("/api/rolling-menu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) }); const body = await response.json(); if (!response.ok) { setError(body.error?.message || "Could not save."); setMessage(""); return false; } setError(""); setSnapshot(body.snapshot); setWeeks(body.weeks || []); setPublicationState(body.publicationState || {}); setMessage("Saved"); window.setTimeout(() => setMessage(""), 1200); return true; }, []);
  return { snapshot, setSnapshot, weeks, dishes, publicationState, message, error, setError, load, command };
}
export const slotLabel = (slot: string) => slot.replace(/^SALAD \d+$/, "Salad").replace("COLD PROTEIN", "Cold protein").replace("HOT VEG VEGAN", "Hot veg / vegan").replace("HOT MEAT", "Hot meat").replace(/^EXTRAS \d+$/, "Side").replace("SOUP", "Soup");
export const groupedSlots = (snapshot: RollingSnapshot) => { const slots = Array.from(new Set([...ROLLING_SLOTS, ...(snapshot.week.customSlots || []), ...snapshot.entries.map(entry => entry.slot)])).filter(slot => !snapshot.week.removedSlots?.includes(slot)); const groups: Array<[string, string[]]> = [["SALADS", slots.filter(slot => slot.startsWith("SALAD "))], ["COLD", slots.filter(slot => slot === "COLD PROTEIN")], ["HOT", slots.filter(slot => ["SOUP", "HOT MEAT", "HOT VEG VEGAN"].includes(slot))], ["SIDES", slots.filter(slot => slot.startsWith("EXTRAS ") || !["COLD PROTEIN", "SOUP", "HOT MEAT", "HOT VEG VEGAN"].includes(slot) && !slot.startsWith("SALAD "))]]; return groups.filter(([, values]) => values.length); };
export function patchEntry(entry: RollingEntry, patch: Record<string, unknown>) { return { action: "update-entry", weekId: entry.id.split(":entry:")[0], entryId: entry.id, patch }; }
