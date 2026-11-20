import { NextRequest, NextResponse } from "next/server";
import { saveWeekDraft } from "@/lib/week-draft-save";
import {
  addMenuSlot,
  addOneOffDestination,
  batchUpdateEntries,
  cleanDuplicateEntries,
  createEntry,
  createOrReuseBlankWeek,
  createWeekSnapshot,
  defaultWeekForDate,
  duplicateWeek,
  getWeek,
  listWeeks,
  normaliseRollingSnapshotDestinations,
  planningWeekCommencing,
  planningWeekFromQuery,
  removeMenuSlot,
  resetWeek,
  saveSnapshot,
  setWeekAvailableToHospitality,
  updateEntry,
  validateWeek,
  validateWeekAuthoritative,
} from "@/lib/rolling-menu";
import {
  assertAmendmentPaxScope,
  createPublishedMenuWeek,
  getMenuPublication,
  previewPublishedWeekAmendment,
  publishScopedPublishedWeekAmendment,
  publicationDayBlockers,
  publicationPreview,
  publicationState,
  publicationWeekBlockers,
} from "@/lib/menu-publication";
import {
  actorCanAccessOploc,
  actorCanReadAllocation,
  actorCanManageOrganisation,
  actorCanWriteOneOff,
  actorCanWriteOploc,
  requireMutationActor,
  requireOrganisationMutationActor,
  menuReadScopeKey,
  requirePublicationActor,
  resolveMenuActor,
  scopeMenuPublication,
  scopeMenuSitePax,
  type MenuActor,
} from "@/lib/auth";
import { assertMenuAllocationsScope, assertMenuSnapshotMutationScope, assertPublishedAmendmentScope, assertPublishedMenuDaysScope, requireSharedMenuWriter } from "@/lib/menu-mutation-scope";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { queuedPublicationHandoff } from "@/lib/publication-handoff";
import {
  catalogueEntriesForItems,
  listCatalogueEntriesForIds,
} from "@/lib/catalogue";
import { resolveWeekDishReferences } from "@/lib/dish-reference-resolver";
import { resolveAllergenSnapshot } from "@/lib/allergen-resolution";
import {
  getWeekHead,
  getWeekSnapshot,
  listWeekSummaries,
} from "@/lib/operational-store";
import type { RollingEntry, RollingWeek } from "@/lib/rolling-menu-types";
import {
  duplicateMenuPlanning,
  type DuplicateDestinationRequest,
} from "@/lib/menu-duplicate-command";
import type {
  DuplicateContent,
  DuplicateExisting,
  DuplicateScope,
} from "@/lib/menu-duplicate";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import type { GovernedOploc } from "@/lib/oploc-authority";

const oplocAliases = (sites: readonly GovernedOploc[]) => new Map(sites.flatMap(site => (site.legacyIds || []).map(id => [id, site.canonicalId] as const)));

function visibleWeekSummary(week: RollingWeek, actor: MenuActor) {
  if (actor.allOplocs) return week;
  const { hospitalityDemandAllocations: _historicalDemand, ...safe } = week as RollingWeek & { hospitalityDemandAllocations?: unknown };
  return { ...safe, sourceFiles: [], audit: [], entryIds: [], occupied: week.entryIds.length > 0 };
}

function scopedSnapshot(
  snapshot: Awaited<ReturnType<typeof getWeek>>,
  actor?: MenuActor,
) {
  if (!actor || actor.allOplocs) return snapshot;
  const entries = snapshot.entries.flatMap(entry => {
    const allocations = entry.allocations.filter(allocation => actorCanReadAllocation(actor, allocation));
    if (!allocations.length && (entry.allocations.length || !actor.oplocIds.length)) return [];
    return [{ ...entry, source: undefined, allocations, portions: allocations.reduce((total, allocation) => total + allocation.quantity, 0) }];
  });
  const ids = new Set(entries.map(entry => entry.id));
  const week = { ...visibleWeekSummary(snapshot.week, actor), entryIds: snapshot.week.entryIds.filter(id => ids.has(id)) };
  const days = snapshot.days.map(day => ({
    ...day, oneOffDestinations: undefined, entryIds: day.entryIds.filter(id => ids.has(id)), destinationPax: scopeMenuSitePax(day.destinationPax, actor),
  }));
  return { ...snapshot, week, entries, days };
}

async function resolvedSnapshot(
  snapshot: Awaited<ReturnType<typeof getWeek>>,
  catalogue?: Awaited<ReturnType<typeof listCatalogueEntriesForIds>>,
  actor?: MenuActor,
) {
  snapshot = scopedSnapshot(snapshot, actor);
  const referencedIds = snapshot.entries
    .filter((entry) => entry.itemLabel.trim())
    .map((entry) => entry.itemId || "");
  const resolvedCatalogue =
    catalogue || (await listCatalogueEntriesForIds(referencedIds));
  const catalogueIssues = snapshot.entries
    .filter(
      (entry) =>
        entry.itemLabel.trim() &&
        (!entry.itemId ||
          !resolvedCatalogue.some((item) => item.id === entry.itemId)),
    )
    .map((entry) => ({
      entryId: entry.id,
      itemLabel: entry.itemLabel,
      reason: entry.itemId
        ? "catalogue-item-not-found"
        : "missing-stable-catalogue-id",
    }));
  const entries = snapshot.entries.map((entry) => {
    // A display label is not a stable identity. Missing IDs remain unresolved
    // until the explicit catalogue reconciliation/migration path repairs them.
    const dish = entry.itemId
      ? resolvedCatalogue.find((item) => item.id === entry.itemId)?.item
      : undefined;
    const resolved = resolveAllergenSnapshot(
      entry,
      dish
        ? {
            canonicalId: dish.canonicalId,
            displayName: dish.displayName,
            allergenEvidence: dish.allergenEvidence,
            mayContainReviewed: dish.mayContainReviewed,
            mayContainNotes: dish.mayContainNotes,
          }
        : undefined,
    );
    return {
      ...entry,
      allergens: resolved.allergens,
      mayContainNotes: entry.mayContainNotes || resolved.mayContainNotes,
    };
  });
  return {
    ...snapshot,
    entries,
    ...(catalogueIssues.length ? { catalogueIssues } : {}),
  };
}

async function handleGet(request: NextRequest) {
  try {
    const actor = await resolveMenuActor(request);
    const headers = { "Cache-Control": "private, no-store", "x-fika-menu-cache-scope": menuReadScopeKey(actor) };
    const requestedWeek =
      request.nextUrl.searchParams.get("weekId") || undefined;
    const totalStarted = performance.now();
    const summaryStarted = performance.now();
    const summariesOnly =
      request.nextUrl.searchParams.get("summariesOnly") === "true";
    const snapshotOnly =
      request.nextUrl.searchParams.get("snapshotOnly") === "true";
    if (summariesOnly && requestedWeek) {
      const week = await getWeekHead<RollingWeek>(requestedWeek);
      console.info("Menu Planning rolling-menu week head timing", {
        rollingStateMs: performance.now() - summaryStarted,
        totalMs: performance.now() - totalStarted,
        weekId: requestedWeek,
        found: Boolean(week),
      });
      return NextResponse.json({
        week: week
          ? {
              id: week.id,
              weekCommencing: week.weekCommencing,
              version: week.version,
            }
          : null,
      }, { headers });
    }
    const weeks =
      snapshotOnly && requestedWeek
        ? []
        : (await listWeekSummaries<RollingWeek>())
            .slice()
            .sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
    const rollingStateMs = performance.now() - summaryStarted;
    if (summariesOnly) {
      console.info("Menu Planning rolling-menu summaries timings", {
        rollingStateMs,
        totalMs: performance.now() - totalStarted,
      });
      return NextResponse.json({ weeks: weeks.map(week => visibleWeekSummary(week, actor)) }, { headers });
    }
    const requestedWeekCommencing = requestedWeek
      ? planningWeekFromQuery(requestedWeek)
      : undefined;
    const matchingWeek = requestedWeek
      ? weeks.find(
          (week) =>
            week.id === requestedWeek ||
            week.weekCommencing === requestedWeek ||
            week.weekCommencing === requestedWeekCommencing,
        )
      : undefined;
    const selectedWeek =
      snapshotOnly && requestedWeek
        ? await getWeekHead<RollingWeek>(requestedWeek)
        : matchingWeek || defaultWeekForDate(weeks, requestedWeekCommencing);
    const selectedReadStarted = performance.now();
    const storedSnapshot = selectedWeek
      ? await getWeekSnapshot<Awaited<ReturnType<typeof getWeek>>>(
          selectedWeek.id,
        )
      : undefined;
    const selectedWeekMs = performance.now() - selectedReadStarted;
    const previewDayId = request.nextUrl.searchParams.get("dayId") || undefined;
    const publicationPreviewRequested =
      request.nextUrl.searchParams.get("publicationPreview") === "true";
    const amendmentPreviewRequested =
      request.nextUrl.searchParams.get("amendmentPreview") === "true";
    // All rolling reads use the live Hub redirect projection so an old explicit
    // destination ID is canonicalised before it reaches the UI or cache.
    const governedOplocs = (await readDeliveredInOplocs(request)).filter(
      (oploc) => actorCanAccessOploc(actor, oploc.canonicalId),
    );
    const sourceSnapshot = normaliseRollingSnapshotDestinations(
      storedSnapshot ||
        await createWeekSnapshot(
          requestedWeekCommencing || planningWeekFromQuery(undefined),
        ),
      governedOplocs,
    );
    const snapshot = scopedSnapshot(sourceSnapshot, actor);
    const governedOplocIds = governedOplocs
      ? new Set(governedOplocs.map((oploc) => oploc.canonicalId))
      : undefined;
    const catalogueStarted = performance.now();
    const publicationStarted = performance.now();
    const referenceResult = await resolveWeekDishReferences(snapshot, actor);
    const catalogue = catalogueEntriesForItems(referenceResult.items);
    const currentPublicationState = await publicationState(snapshot, governedOplocs, catalogue.map(entry => entry.item).filter((item): item is NonNullable<typeof item> => Boolean(item)), publication => scopeMenuPublication(publication, actor));
    const catalogueMs = performance.now() - catalogueStarted;
    const publicationStateMs = performance.now() - publicationStarted;
    const resolved = await resolvedSnapshot(snapshot, catalogue, actor);
    const publishableOplocs = governedOplocs.filter(oploc => actorCanWriteOploc(actor, oploc.canonicalId, "publish"));
    if (amendmentPreviewRequested) {
      requirePublicationActor(actor);
      assertMenuSnapshotMutationScope(sourceSnapshot, actor, "publish", oplocAliases(governedOplocs));
    }
    const amendmentPreview = amendmentPreviewRequested ? await previewPublishedWeekAmendment(snapshot.week.id, publishableOplocs) : undefined;
    if (amendmentPreview) {
      assertPublishedAmendmentScope(amendmentPreview.changeSet, actor, oplocAliases(governedOplocs));
      if (!actorCanWriteOneOff(actor, "publish")) assertAmendmentPaxScope(amendmentPreview.changeSet, new Set(publishableOplocs.map(site => site.canonicalId)));
    }
    const activeCanonicalDishIds = new Set(catalogue.map((entry) => entry.id));
    console.info("Menu Planning rolling-menu GET timings", {
      rollingStateMs,
      selectedWeekMs,
      catalogueMs,
      publicationStateMs,
      totalMs: performance.now() - totalStarted,
    });
    return NextResponse.json({
      snapshot: resolved,
      dishReferences: referenceResult.dishReferences,
      weeks: weeks.map(week => visibleWeekSummary(week, actor)),
      blockers: validateWeek(snapshot, { requireCanonicalDishId: true, activeCanonicalDishIds }),
      publicationState: currentPublicationState,
      ...(publicationPreviewRequested
        ? {
            publicationPreview: publicationPreview(snapshot, previewDayId, catalogue.map(entry => entry.item).filter((item): item is NonNullable<typeof item> => Boolean(item)), { requireAuthoritativeCatalogue: ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "") }),
            dayBlockers: previewDayId
              ? publicationDayBlockers(snapshot, previewDayId, governedOplocIds, activeCanonicalDishIds)
              : [],
            weekBlockers: publicationWeekBlockers(snapshot, governedOplocIds, activeCanonicalDishIds),
          }
        : {}),
      ...(amendmentPreview ? { amendmentPreview } : {}),
    }, { headers });
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Rolling menu could not be loaded.",
        },
      },
      { status },
    );
  }
}

async function handlePost(request: NextRequest) {
  try {
    const actor = requireMutationActor(await resolveMenuActor(request));
    const headers = { "Cache-Control": "private, no-store", "x-fika-menu-cache-scope": menuReadScopeKey(actor) };
    const respond = (body: unknown) => NextResponse.json(body, { headers });
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "publish" || action === "publish-amendment") requirePublicationActor(actor);
    const readableOplocs = (await readDeliveredInOplocs(request)).filter((oploc) =>
      actorCanAccessOploc(actor, oploc.canonicalId),
    );
    const liveOplocs = readableOplocs.filter(oploc => actorCanWriteOploc(actor, oploc.canonicalId, "manage"));
    const aliases = oplocAliases(readableOplocs);
    const mutationScope = (snapshot: Awaited<ReturnType<typeof getWeek>>) => assertMenuSnapshotMutationScope(snapshot, actor, "manage", aliases);
    const entryScope = (entry: RollingEntry) => {
      if (!entry.allocations.length) requireOrganisationMutationActor(actor);
      assertMenuAllocationsScope(actor, "manage", entry.allocations, aliases);
    };
    const readWeeks = async () => (await listWeeks()).map(week => visibleWeekSummary(week, actor));
    if (action === "publish-amendment") {
      const weekId = String(body.weekId || "");
      const oplocs = liveOplocs.filter(oploc => actorCanWriteOploc(actor, oploc.canonicalId, "publish"));
      const governedOplocIds = new Set(oplocs.map(oploc => oploc.canonicalId));
      const sourceSnapshot = normaliseRollingSnapshotDestinations(await getWeek(weekId), readableOplocs);
      assertMenuSnapshotMutationScope(sourceSnapshot, actor, "publish", aliases);
      const publication = await publishScopedPublishedWeekAmendment(weekId, {
        sourceWeekVersion: Number(body.sourceWeekVersion),
        publicationVersion: Number(body.publicationVersion),
        changeSetHash: String(body.changeSetHash || ""),
        requestId: String(body.requestId || ""),
      }, actor.uid, governedOplocIds, oplocs, actorCanWriteOneOff(actor, "publish") ? undefined : governedOplocIds, (snapshot, changes) => {
        assertMenuSnapshotMutationScope(snapshot, actor, "publish", aliases);
        assertPublishedAmendmentScope(changes, actor, aliases);
      });
      const handoff = queuedPublicationHandoff(publication);
      const saved = await getWeek(weekId);
      const published = await getMenuPublication(publication.publicationId);
      return respond({
        snapshot: await resolvedSnapshot(saved, undefined, actor),
        publication: published ? scopeMenuPublication(published, actor) : undefined,
        handoff,
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(saved, actor)),
        publicationState: await publicationState(saved, oplocs),
      });
    }
    if (action === "save-week") {
      const { action: _action, ...saveRequest } = body;
      const result = await saveWeekDraft(saveRequest, actor.uid, new Set(liveOplocs.map(oploc => oploc.canonicalId)), aliases, actorCanWriteOneOff(actor, "manage"), actorCanManageOrganisation(actor));
      const snapshot = scopedSnapshot(normaliseRollingSnapshotDestinations(result.snapshot, readableOplocs), actor);
      return respond({ snapshot, replayed: result.replayed, publicationState: await publicationState(snapshot, readableOplocs) });
    }
    if (action === "set-hospitality-availability") {
      requireOrganisationMutationActor(actor);
      const result = await setWeekAvailableToHospitality(String(body.weekId || ""), Number(body.expectedWeekVersion), body.available === true, actor.uid, mutationScope);
      const snapshot = await getWeek(result.week.id);
      return respond({ snapshot: scopedSnapshot(snapshot, actor), weeks: await readWeeks(), changed: result.changed, publicationState: await publicationState(scopedSnapshot(snapshot, actor), readableOplocs) });
    }
    if (action === "create-week") {
      requireOrganisationMutationActor(actor);
      const weekCommencing = planningWeekCommencing(
        String(body.weekCommencing),
      );
      const snapshot = await createOrReuseBlankWeek(weekCommencing, actor.uid);
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "duplicate-week") {
      requireOrganisationMutationActor(actor);
      const snapshot = await duplicateWeek(
        String(body.weekId),
        planningWeekCommencing(String(body.weekCommencing)),
        actor.uid,
        liveOplocs,
        mutationScope,
      );
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor), {
          governedOplocIds: new Set(liveOplocs.map((oploc) => oploc.canonicalId)),
        }),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "duplicate-plan") {
      requireOrganisationMutationActor(actor);
      // One authoritative Duplicate Planning command for Week and Portion Planner. The server
      // recomputes the plan; the client only states intent and the reviewed versions/hash.
      const result = await duplicateMenuPlanning(
        {
          mode: body.mode === "apply" ? "apply" : "preview",
          sourceWeekId: String(body.sourceWeekId || ""),
          scope: body.scope as DuplicateScope,
          destinations: Array.isArray(body.destinations)
            ? (body.destinations as DuplicateDestinationRequest[])
            : [],
          content: body.content as DuplicateContent,
          existing: body.existing as DuplicateExisting,
          operationId: String(body.operationId || ""),
          expectedVersions: body.expectedVersions as Record<string, number> | undefined,
          planHash: body.planHash ? String(body.planHash) : undefined,
          targetHashes: body.targetHashes && typeof body.targetHashes === "object" ? (body.targetHashes as Record<string, string>) : undefined,
        },
        actor.uid,
        liveOplocs,
        undefined,
        mutationScope,
      );
      return respond(result);
    }
    if (action === "reset-week") {
      requireOrganisationMutationActor(actor);
      const snapshot = await resetWeek(String(body.weekId), Number(body.expectedWeekVersion), actor.uid, mutationScope);
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "update-entry") {
      const patch = (body.patch || {}) as import("@/lib/rolling-command").RollingEntryPatch;
      if (patch.allocations) assertMenuAllocationsScope(actor, "manage", patch.allocations, aliases);
      const mutation = await updateEntry(
        String(body.weekId),
        String(body.entryId),
        patch,
        actor.uid,
        liveOplocs,
        Number(body.expectedWeekVersion),
        body.dayId ? String(body.dayId) : undefined,
        entryScope,
      );
      return respond({ mutation: { ...mutation, week: visibleWeekSummary(mutation.week, actor) } });
    }
    if (action === "batch-update-entries") {
      const updates = Array.isArray(body.updates)
        ? (body.updates as Array<{
            entryId: string;
            dayId: string;
            allocations?: RollingEntry["allocations"];
            patch?: Record<string, unknown>;
          }>)
        : [];
      for (const update of updates) assertMenuAllocationsScope(actor, "manage", (update.patch?.allocations as RollingEntry["allocations"] | undefined) ?? update.allocations ?? [], aliases);
      const mutation = await batchUpdateEntries(
        String(body.weekId),
        Number(body.expectedWeekVersion),
        updates,
        actor.uid,
        liveOplocs,
        entryScope,
      );
      const saved = scopedSnapshot(
        normaliseRollingSnapshotDestinations(
          await getWeek(String(body.weekId)),
          liveOplocs,
        ),
        actor,
      );
      const catalogue = await listCatalogueEntriesForIds(
        saved.entries.map((entry) => entry.itemId || ""),
      );
      return respond({
        mutation: { ...mutation, week: visibleWeekSummary(mutation.week, actor) },
        publicationState: await publicationState(
          saved,
          liveOplocs,
          catalogue
            .map((entry) => entry.item)
            .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        ),
      });
    }
    if (action === "create-entry") {
      requireOrganisationMutationActor(actor);
      const snapshot = await createEntry(
        String(body.weekId),
        String(body.dayId),
        String(body.slot) as never,
        String(body.itemLabel || ""),
        actor.uid,
        body.itemId ? String(body.itemId) : undefined,
        body.expectedWeekVersion === undefined ? undefined : Number(body.expectedWeekVersion),
      );
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "add-one-off-destination") {
      requireSharedMenuWriter(actor);
      const snapshot = await addOneOffDestination(
        String(body.weekId),
        String(body.dayId),
        String(body.label || ""),
        String(body.address || ""),
        actor.uid,
      );
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "add-menu-slot") {
      requireOrganisationMutationActor(actor);
      if (body.persistence === "template") requireSharedMenuWriter(actor);
      const result = await addMenuSlot(
        String(body.weekId),
        String(body.category || ""),
        String(body.persistence || ""),
        actor.uid,
      );
      const snapshot = result.snapshot;
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        slot: result.slot,
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "remove-menu-slot") {
      requireOrganisationMutationActor(actor);
      const snapshot = await removeMenuSlot(
        String(body.weekId),
        String(body.slot || ""),
        actor.uid,
      );
      return respond({
        snapshot: await resolvedSnapshot(snapshot, undefined, actor),
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(snapshot, actor)),
        publicationState: await publicationState(snapshot, liveOplocs),
      });
    }
    if (action === "clean-duplicate-entries") {
      requireOrganisationMutationActor(actor);
      const result = await cleanDuplicateEntries(
        String(body.weekId),
        actor.uid,
        liveOplocs,
        mutationScope,
      );
      return respond({
        snapshot: await resolvedSnapshot(result.snapshot, undefined, actor),
        removed: result.removed,
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(result.snapshot, actor), {
          governedOplocIds: new Set(liveOplocs.map((oploc) => oploc.canonicalId)),
        }),
        publicationState: await publicationState(result.snapshot, liveOplocs),
      });
    }
    if (action === "publish") {
      const requestedWeekId = String(body.weekId);
      const oplocs = liveOplocs.filter(oploc => actorCanWriteOploc(actor, oploc.canonicalId, "publish"));
      const sourceSnapshot = normaliseRollingSnapshotDestinations(
        await getWeek(requestedWeekId),
        readableOplocs,
      );
      assertMenuSnapshotMutationScope(sourceSnapshot, actor, "publish", aliases);
      const publication = await createPublishedMenuWeek(
        requestedWeekId,
        {
          weekContentHash:
            typeof body.weekContentHash === "string"
              ? body.weekContentHash
              : undefined,
        },
        actor.uid,
        new Set(oplocs.map((oploc) => oploc.canonicalId)),
        oplocs,
        (snapshot, previousDays) => {
          assertMenuSnapshotMutationScope(snapshot, actor, "publish", aliases);
          assertPublishedMenuDaysScope(previousDays, actor, aliases);
        },
      );
      const handoff = queuedPublicationHandoff(publication);
      const saved = await getWeek(requestedWeekId);
      const published = await getMenuPublication(publication.publicationId);
      return respond({
        snapshot: await resolvedSnapshot(saved, undefined, actor),
        publication: published
          ? scopeMenuPublication(published, actor)
          : undefined,
        handoff,
        weeks: await readWeeks(),
        blockers: await validateWeekAuthoritative(scopedSnapshot(saved, actor)),
        publicationState: await publicationState(saved, liveOplocs),
      });
    }
    return NextResponse.json(
      { error: { message: "Unknown rolling menu command." } },
      { status: 400 },
    );
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 400;
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Rolling menu command failed.",
          ...(error && typeof error === "object" && "validationErrors" in error
            ? { validationErrors: (error as { validationErrors: unknown }).validationErrors }
            : {}),
        },
      },
      { status },
    );
  }
}

export async function GET(request: NextRequest) {
  /* handleGet performs getWeekHead for targeted revalidation; normal reads use listWeekSummaries, getWeekSnapshot, and Promise.all([listCatalogueEntriesForIds(...), publicationState(...)]) without reconciliation writes. */ return withDataTrace(
    {
      app: "menu-planning",
      action:
        request.nextUrl.searchParams.get("summariesOnly") === "true"
          ? "menu-planning.week.summaries"
          : "menu-planning.week.open",
      path: request.nextUrl.pathname,
      requestId: request.headers.get("x-request-id") || undefined,
    },
    () => handleGet(request),
  );
}
export async function POST(request: NextRequest) {
  return withDataTrace(
    {
      app: "menu-planning",
      action: "menu-planning.mutation",
      path: request.nextUrl.pathname,
      requestId: request.headers.get("x-request-id") || undefined,
    },
    () => handlePost(request),
  );
}
