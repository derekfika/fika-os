import { NextRequest, NextResponse } from "next/server";
import { addMenuSlot, addOneOffDestination, assertWeekDateAvailable, cleanDuplicateEntries, copyWeekIntoWeek, createEntry, duplicateWeek, emptyWeek, getWeek, listWeeks, removeMenuSlot, resetWeek, saveSnapshot, snapshotFromStored, updateEntry, validateWeek, type Stored } from "@/lib/rolling-menu";
import { archivePublishedDayMatrix, createPublishedMenuDay, getMenuPublication, publicationDayBlockers, publicationPreview, publicationState, type MenuPublicationSignoff } from "@/lib/menu-publication";
import { requireMutationActor, requirePublicationActor, resolveMenuActor } from "@/lib/auth";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";
import { listCatalogueEntries, reconcileCatalogueFromRollingEntries } from "@/lib/catalogue";
import { resolveAllergenSnapshot } from "@/lib/allergen-resolution";
import { GOVERNED_OPLOCS } from "@/lib/fika-contracts";
import { readRollingState } from "@/lib/operational-store";

async function resolvedSnapshot(snapshot: Awaited<ReturnType<typeof getWeek>>, onCatalogueTiming?: (durationMs: number) => void) {
  const catalogueStarted = performance.now();
  const catalogue = await listCatalogueEntries();
  onCatalogueTiming?.(performance.now() - catalogueStarted);
  const entries = snapshot.entries.map(entry => {
    const dish = catalogue.find(item => item.id === entry.itemId || item.name.trim().toLocaleLowerCase() === entry.itemLabel.trim().toLocaleLowerCase())?.item;
    const resolved = resolveAllergenSnapshot(entry, dish ? { canonicalId: dish.canonicalId, displayName: dish.displayName, allergenEvidence: dish.allergenEvidence, mayContainReviewed: dish.mayContainReviewed, mayContainNotes: dish.mayContainNotes } : undefined);
    return { ...entry, allergens: resolved.allergens, mayContainNotes: entry.mayContainNotes || resolved.mayContainNotes };
  });
  return { ...snapshot, entries };
}

export async function GET(request: NextRequest) {
  try {
    const requestedWeek = request.nextUrl.searchParams.get("weekId") || undefined;
    const totalStarted = performance.now();
    const rollingStarted = performance.now();
    const state = await readRollingState<Stored>();
    const rollingStateMs = performance.now() - rollingStarted;
    const weeks = state.weeks.slice().sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
    const matchingWeek = requestedWeek ? weeks.find(week => week.id === requestedWeek || week.weekCommencing === requestedWeek) : undefined;
    const snapshot = snapshotFromStored(state, matchingWeek?.id || requestedWeek);
    const previewDayId = request.nextUrl.searchParams.get("dayId") || undefined;
    const publicationPreviewRequested = request.nextUrl.searchParams.get("publicationPreview") === "true";
    const governedOplocs = publicationPreviewRequested ? await readDeliveredInOplocs(request) : undefined;
    const governedLabels = new Set(governedOplocs?.map(oploc => oploc.label.toLocaleLowerCase()));
    const governedOplocIds = governedOplocs ? new Set([...governedOplocs.map(oploc => oploc.canonicalId), ...GOVERNED_OPLOCS.filter(oploc => governedLabels.has(oploc.label.toLocaleLowerCase())).map(oploc => oploc.id)]) : undefined;
    let catalogueMs = 0;
    const resolved = await resolvedSnapshot(snapshot, durationMs => { catalogueMs = durationMs; });
    const publicationStarted = performance.now();
    const currentPublicationState = await publicationState(snapshot);
    const publicationStateMs = performance.now() - publicationStarted;
    console.info("Menu Planning rolling-menu GET timings", { rollingStateMs, catalogueMs, publicationStateMs, totalMs: performance.now() - totalStarted });
    return NextResponse.json({ snapshot: resolved, weeks, blockers: validateWeek(snapshot), publicationState: currentPublicationState, ...(publicationPreviewRequested ? { publicationPreview: publicationPreview(snapshot, previewDayId), dayBlockers: previewDayId ? publicationDayBlockers(snapshot, previewDayId, governedOplocIds) : [] } : {}) });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu could not be loaded." } }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const actor = requireMutationActor(await resolveMenuActor(request));
    if (action === "create-week") {
      await assertWeekDateAvailable(String(body.weekCommencing));
      const snapshot = await saveSnapshot(emptyWeek(String(body.weekCommencing), actor.uid));
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "duplicate-week") {
      const snapshot = await duplicateWeek(String(body.weekId), String(body.weekCommencing), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "copy-week-into-current") {
      const snapshot = await copyWeekIntoWeek(String(body.sourceWeekId), String(body.targetWeekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "reset-week") {
      const snapshot = await resetWeek(String(body.weekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "update-entry") {
      const snapshot = await updateEntry(String(body.weekId), String(body.entryId), (body.patch || {}) as never, actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "create-entry") {
      const snapshot = await createEntry(String(body.weekId), String(body.dayId), String(body.slot) as never, String(body.itemLabel || ""), actor.uid, body.itemId ? String(body.itemId) : undefined);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "add-one-off-destination") {
      const snapshot = await addOneOffDestination(String(body.weekId), String(body.dayId), String(body.label || ""), String(body.address || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "add-menu-slot") {
      const snapshot = await addMenuSlot(String(body.weekId), String(body.slot || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "remove-menu-slot") {
      const snapshot = await removeMenuSlot(String(body.weekId), String(body.slot || ""), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(snapshot), weeks: await listWeeks(), blockers: validateWeek(snapshot), publicationState: await publicationState(snapshot) });
    }
    if (action === "clean-duplicate-entries") {
      const result = await cleanDuplicateEntries(String(body.weekId), actor.uid);
      return NextResponse.json({ snapshot: await resolvedSnapshot(result.snapshot), removed: result.removed, weeks: await listWeeks(), blockers: validateWeek(result.snapshot), publicationState: await publicationState(result.snapshot) });
    }
    if (action === "publish") {
      const dayId = String(body.dayId || "");
      requirePublicationActor(actor);
      // Reconcile exact imported dish names before the publication gate runs.
      // This persists the canonical identity; it does not bypass allergen review.
      await reconcileCatalogueFromRollingEntries();
      const oplocs = await readDeliveredInOplocs(request);
      const publication = await createPublishedMenuDay(String(body.weekId), dayId, (body.signoff || {}) as MenuPublicationSignoff, actor.uid, new Set(oplocs.map(oploc => oploc.canonicalId)));
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent);
      const publishedDay = publication.days.find(day => day.sourceDayId === dayId && day.status === "published");
      if (publishedDay) await archivePublishedDayMatrix(publication.publicationId, publishedDay.publicationDayId);
      const saved = await getWeek(String(body.weekId)); return NextResponse.json({ snapshot: await resolvedSnapshot(saved), publication: await getMenuPublication(publication.publicationId), handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed }, weeks: await listWeeks(), blockers: validateWeek(saved), publicationState: await publicationState(saved) });
    }
    return NextResponse.json({ error: { message: "Unknown rolling menu command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu command failed." } }, { status }); }
}
