import { NextRequest, NextResponse } from "next/server";
import { addMenuSlot, addOneOffDestination, assertWeekDateAvailable, cleanDuplicateEntries, copyWeekIntoWeek, createEntry, defaultWeekForDate, duplicateWeek, emptyWeek, getWeek, listWeeks, normaliseRollingSnapshotDestinations, removeMenuSlot, resetWeek, saveSnapshot, updateEntry, validateWeek } from "@/lib/rolling-menu";
import { createPublishedMenuWeek, getMenuPublication, publicationDayBlockers, publicationPreview, publicationState, publicationWeekBlockers } from "@/lib/menu-publication";
import { actorCanAccessOploc, assertActorCanAccessOploc, requireMutationActor, requirePublicationActor, resolveMenuActor, scopeMenuPublication, type MenuActor } from "@/lib/auth";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";
import { listCatalogueEntriesForIds, reconcileCatalogueFromRollingEntries } from "@/lib/catalogue";
import { resolveAllergenSnapshot } from "@/lib/allergen-resolution";
import { GOVERNED_OPLOCS } from "@/lib/fika-contracts";
import { getWeekHead, getWeekSnapshot, listWeekSummaries } from "@/lib/operational-store";
import type { RollingWeek } from "@/lib/rolling-menu-types";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

function scopedSnapshot(snapshot: Awaited<ReturnType<typeof getWeek>>, actor?: MenuActor) {
  if (!actor || actor.allOplocs) return snapshot;
  const entries = snapshot.entries
    .map(entry => ({ ...entry, allocations: entry.allocations.filter(allocation => actorCanAccessOploc(actor, allocation.destinationId)) }))
    // A destination-bearing entry with no visible allocation belongs to
    // another OPLOC and must not leak through a week snapshot.
    .filter(entry => entry.allocations.length > 0 || entry.allocations.length === snapshot.entries.find(candidate => candidate.id === entry.id)?.allocations.length);
  return { ...snapshot, entries };
}

function assertSnapshotScope(snapshot: Awaited<ReturnType<typeof getWeek>>, actor: MenuActor) {
  if (actor.allOplocs) return;
  for (const entry of snapshot.entries) for (const allocation of entry.allocations) {
    if (allocation.destinationId && !actorCanAccessOploc(actor, allocation.destinationId)) assertActorCanAccessOploc(actor, allocation.destinationId);
  }
}

async function resolvedSnapshot(snapshot: Awaited<ReturnType<typeof getWeek>>, catalogue?: Awaited<ReturnType<typeof listCatalogueEntriesForIds>>, actor?: MenuActor) {
  snapshot = scopedSnapshot(snapshot, actor);
  const referencedIds = snapshot.entries.filter(entry => entry.itemLabel.trim()).map(entry => entry.itemId || "");
  const resolvedCatalogue = catalogue || await listCatalogueEntriesForIds(referencedIds);
  const catalogueIssues = snapshot.entries.filter(entry => entry.itemLabel.trim() && (!entry.itemId || !resolvedCatalogue.some(item => item.id === entry.itemId))).map(entry => ({ entryId: entry.id, itemLabel: entry.itemLabel, reason: entry.itemId ? "catalogue-item-not-found" : "missing-stable-catalogue-id" }));
  const entries = snapshot.entries.map(entry => {
    // A display label is not a stable identity. Missing IDs remain unresolved
    // until the explicit catalogue reconciliation/migration path repairs them.
    const dish = entry.itemId ? resolvedCatalogue.find(item => item.id === entry.itemId)?.item : undefined;
    const resolved = resolveAllergenSnapshot(entry, dish ? { canonicalId: dish.canonicalId, displayName: dish.displayName, allergenEvidence: dish.allergenEvidence, mayContainReviewed: dish.mayContainReviewed, mayContainNotes: dish.mayContainNotes } : undefined);
    return { ...entry, allergens: resolved.allergens, mayContainNotes: entry.mayContainNotes || resolved.mayContainNotes };
  });
  return { ...snapshot, entries, ...(catalogueIssues.length ? { catalogueIssues } : {}) };
}

async function handleGet(request: NextRequest) {
  try {
    const actor = await resolveMenuActor(request);
    const requestedWeek = request.nextUrl.searchParams.get("weekId") || undefined;
    const totalStarted = performance.now();
    const summaryStarted = performance.now();
    const summariesOnly = request.nextUrl.searchParams.get("summariesOnly") === "true";
    const snapshotOnly = request.nextUrl.searchParams.get("snapshotOnly") === "true";
    if (summariesOnly && requestedWeek) {
      const week = await getWeekHead<RollingWeek>(requestedWeek);
      console.info("Menu Planning rolling-menu week head timing", { rollingStateMs: performance.now() - summaryStarted, totalMs: performance.now() - totalStarted, weekId: requestedWeek, found: Boolean(week) });
      return NextResponse.json({ week: week ? { id: week.id, weekCommencing: week.weekCommencing, version: week.version } : null });
    }
    const weeks = snapshotOnly && requestedWeek ? [] : (await listWeekSummaries<RollingWeek>()).slice().sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
    const rollingStateMs = performance.now() - summaryStarted;
    if (summariesOnly) {
      console.info("Menu Planning rolling-menu summaries timings", { rollingStateMs, totalMs: performance.now() - totalStarted });
      return NextResponse.json({ weeks });
    }
    const matchingWeek = requestedWeek ? weeks.find(week => week.id === requestedWeek || week.weekCommencing === requestedWeek) : undefined;
    const selectedWeek = snapshotOnly && requestedWeek ? await getWeekHead<RollingWeek>(requestedWeek) : matchingWeek || defaultWeekForDate(weeks);
    const selectedReadStarted = performance.now();
    const storedSnapshot = selectedWeek ? await getWeekSnapshot<Awaited<ReturnType<typeof getWeek>>>(selectedWeek.id) : undefined;
    const selectedWeekMs = performance.now() - selectedReadStarted;
    const previewDayId = request.nextUrl.searchParams.get("dayId") || undefined;
    const publicationPreviewRequested = request.nextUrl.searchParams.get("publicationPreview") === "true";
    const governedOplocs = publicationPreviewRequested ? (await readDeliveredInOplocs(request)).filter(oploc => actorCanAccessOploc(actor, oploc.canonicalId)) : undefined;
    const snapshot = scopedSnapshot(normaliseRollingSnapshotDestinations(storedSnapshot || emptyWeek(requestedWeek || new Date().toISOString().slice(0, 10)), governedOplocs), actor);
    const governedLabels = new Set(governedOplocs?.map(oploc => oploc.label.toLocaleLowerCase()));
    const governedOplocIds = governedOplocs ? new Set([...governedOplocs.map(oploc => oploc.canonicalId), ...GOVERNED_OPLOCS.filter(oploc => governedLabels.has(oploc.label.toLocaleLowerCase())).map(oploc => oploc.id)]) : undefined;
    const catalogueStarted = performance.now();
    const publicationStarted = performance.now();
    const [catalogue, currentPublicationState] = await Promise.all([listCatalogueEntriesForIds(snapshot.entries.map(entry => entry.itemId || "")), publicationState(snapshot)]);
    const catalogueMs = performance.now() - catalogueStarted;
    const publicationStateMs = performance.now() - publicationStarted;
    const resolved = await resolvedSnapshot(snapshot, catalogue, actor);
    console.info("Menu Planning rolling-menu GET timings", { rollingStateMs, selectedWeekMs, catalogueMs, publicationStateMs, totalMs: performance.now() - totalStarted });
    return NextResponse.json({ snapshot: resolved, weeks, blockers: validateWeek(snapshot), publicationState: currentPublicationState, ...(publicationPreviewRequested ? { publicationPreview: publicationPreview(snapshot, previewDayId), dayBlockers: previewDayId ? publicationDayBlockers(snapshot, previewDayId, governedOplocIds) : [], weekBlockers: publicationWeekBlockers(snapshot, governedOplocIds) } : {}) });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu could not be loaded." } }, { status });
  }
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const actor = requireMutationActor(await resolveMenuActor(request));
    if (action === "create-week") {
      await assertWeekDateAvailable(String(body.weekCommencing));
      const snapshot = await saveSnapshot(emptyWeek(String(body.weekCommencing), actor.uid));
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "duplicate-week") {
      const snapshot = await duplicateWeek(String(body.weekId), String(body.weekCommencing), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "copy-week-into-current") {
      const snapshot = await copyWeekIntoWeek(String(body.sourceWeekId), String(body.targetWeekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "reset-week") {
      const snapshot = await resetWeek(String(body.weekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "update-entry") {
      const snapshot = await updateEntry(String(body.weekId), String(body.entryId), (body.patch || {}) as never, actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "create-entry") {
      const snapshot = await createEntry(String(body.weekId), String(body.dayId), String(body.slot) as never, String(body.itemLabel || ""), actor.uid, body.itemId ? String(body.itemId) : undefined);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "add-one-off-destination") {
      const snapshot = await addOneOffDestination(String(body.weekId), String(body.dayId), String(body.label || ""), String(body.address || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "add-menu-slot") {
      const snapshot = await addMenuSlot(String(body.weekId), String(body.slot || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "remove-menu-slot") {
      const snapshot = await removeMenuSlot(String(body.weekId), String(body.slot || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot, undefined, actor), weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(snapshot, actor)), publicationState: await publicationState(snapshot) });
    }
    if (action === "clean-duplicate-entries") {
      const result = await cleanDuplicateEntries(String(body.weekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(result.snapshot, undefined, actor), removed: result.removed, weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(result.snapshot, actor)), publicationState: await publicationState(result.snapshot) });
    }
    if (action === "publish") {
      requirePublicationActor(actor);
      const requestedWeekId = String(body.weekId);
      const oplocs = (await readDeliveredInOplocs(request)).filter(oploc => actorCanAccessOploc(actor, oploc.canonicalId));
      const sourceSnapshot = normaliseRollingSnapshotDestinations(await getWeek(requestedWeekId), oplocs);
      assertSnapshotScope(sourceSnapshot, actor);
      // Reconcile exact imported dish names before the publication gate runs.
      // This persists the canonical identity; it does not bypass allergen review.
      await reconcileCatalogueFromRollingEntries({ weekId: requestedWeekId });
      const publication = await createPublishedMenuWeek(requestedWeekId, { weekContentHash: typeof body.weekContentHash === "string" ? body.weekContentHash : undefined }, actor.uid, new Set(oplocs.map(oploc => oploc.canonicalId)), oplocs);
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent);
      const saved = await getWeek(requestedWeekId); const published = await getMenuPublication(publication.publicationId); return NextResponse.json({ snapshot: await resolvedSnapshot(saved, undefined, actor), publication: published ? scopeMenuPublication(published, actor) : undefined, handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed }, weeks: await listWeeks(), blockers: validateWeek(scopedSnapshot(saved, actor)), publicationState: await publicationState(saved) });
    }
    return NextResponse.json({ error: { message: "Unknown rolling menu command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu command failed." } }, { status }); }
}

export async function GET(request: NextRequest) { /* handleGet performs getWeekHead for targeted revalidation; normal reads use listWeekSummaries, getWeekSnapshot, and Promise.all([listCatalogueEntriesForIds(...), publicationState(...)]) without reconciliation writes. */ return withDataTrace({ app: "menu-planning", action: request.nextUrl.searchParams.get("summariesOnly") === "true" ? "menu-planning.week.summaries" : "menu-planning.week.open", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "menu-planning", action: "menu-planning.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
