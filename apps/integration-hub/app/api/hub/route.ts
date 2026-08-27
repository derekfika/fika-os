import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { canApprove, canReview, requireActor } from "@/lib/auth";
import { CanonicalEntityNames, parseCanonical, type CanonicalEntityType, type StagingRecord } from "@/lib/schemas";
import { activity, clearProviderData, completeProviderSync, createRunningSyncRun, failProviderSync, getState, saveLocalSnapshot, updateState, updateSyncRunProgress } from "@/lib/repository";
import { canonicalFromStage, mergeProviderUpdate, proposeMapping, sameProviderIdentity, stageWorksheet } from "@/lib/mapping";
import { classifyProviderIdentity } from "@/lib/legend-identity-reconciliation";
import { createManifest } from "@/lib/manifest";
import { fetchBrightHr, normaliseBrightAbsence, normaliseBrightEmployee } from "@/lib/connectors/brighthr";
import { loadRotaEnrichment, matchRotaLegend, normaliseLegendName } from "@/lib/rota-enrichment";
import { fetchSquare, squareObjects } from "@/lib/connectors/square";
import { sha256, stableId } from "@/lib/profiler";
import { executeProviderSync, type PreparedSync, type SyncProvider } from "@/lib/sync-service";
import { resolveStagingReferences, unresolvedRequiredReference } from "@/lib/reference-resolution";
import { isImportDeferred } from "@/lib/import-policy";
import { confirmedSourceMappings, resolveApprovedCanonicalLifecycle } from "@/lib/governance-repository";
import { redactHubState } from "@/lib/redaction";
import { getFikaRuntimeConfig } from "@/lib/runtime-config";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-mapping"), importId: z.string(), worksheet: z.string(), targetEntity: z.enum(CanonicalEntityNames), fields: z.array(z.object({ source: z.string(), target: z.string().nullable(), transform: z.enum(["none", "trim", "lowercase", "number", "date"]), constant: z.string().optional(), externalIdentifier: z.boolean(), confidence: z.number().min(0).max(1) }).strict()).optional() }).strict(),
  z.object({ action: z.literal("stage"), importId: z.string(), worksheet: z.string(), mappingId: z.string() }).strict(),
  z.object({ action: z.literal("review"), stagingIds: z.array(z.string()).min(1).max(500), decision: z.enum(["approve", "exclude", "unresolved", "resolve-new", "resolve-update"]), reason: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal("correct"), stagingId: z.string(), patch: z.object({ operationalLocationId: z.string().min(1).max(160).optional(), tillItemId: z.string().min(1).max(160).optional(), legendId: z.string().min(1).max(160).optional(), name: z.string().min(1).max(240).optional(), displayName: z.string().min(1).max(240).optional() }).strict() }).strict(),
  z.object({ action: z.literal("sync"), provider: z.enum(["brighthr", "square"]), fullReconciliation: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("reset-provider"), provider: z.enum(["brighthr", "square"]), confirmation: z.literal("RESET LOCAL PROVIDER DATA") }).strict(),
  z.object({ action: z.literal("manifest"), target: z.literal("fika-os-dev") }).strict(),
]);

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    const state = await getState();
    const runtime = getFikaRuntimeConfig();
    return NextResponse.json({ actor, safety: { localOnly: runtime.mode === "local", cloudWrites: false, mode: runtime.mode, projectId: runtime.projectId }, state: redactHubState(state, actor.role) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    const command = Action.parse(await req.json());
    if (!canReview(actor.role)) throw Object.assign(new Error("Viewer is read-only."), { status: 403 });
    if (command.action === "sync") {
      const state = await executeProviderSync(
        { getState, createRunningSyncRun, completeProviderSync, failProviderSync, updateSyncProgress: updateSyncRunProgress },
        actor,
        command.provider,
        Boolean(command.fullReconciliation),
        prepareProviderSync,
      );
      return NextResponse.json({ state });
    }
    const correlationId = crypto.randomUUID();
    const state = await updateState(state => {
      if (command.action === "save-mapping") {
        const profile = state.profiles.find(p => p.importId === command.importId)?.worksheets.find(w => w.name === command.worksheet);
        if (!profile) throw new Error("Worksheet profile not found.");
        const previous = state.mappings.filter(m => m.mappingId === stableId("mapping", `${profile.name}:${command.targetEntity}`)).sort((a, b) => b.version - a.version)[0];
        const mapping = proposeMapping(profile, command.targetEntity, actor.uid);
        mapping.version = (previous?.version || 0) + 1;
        if (command.fields) mapping.fields = command.fields;
        state.mappings.push(mapping);
        state.activity.push(activity(actor, "Mapping saved", mapping.mappingId, "spreadsheet", `${mapping.name} version ${mapping.version}`, correlationId));
      }
      if (command.action === "stage") {
        const profile = state.profiles.find(p => p.importId === command.importId)?.worksheets.find(w => w.name === command.worksheet);
        const mapping = state.mappings.filter(m => m.mappingId === command.mappingId).sort((a, b) => b.version - a.version)[0];
        if (!profile || !mapping) throw new Error("Profile or mapping not found.");
        if (isImportDeferred(mapping.targetEntity)) throw Object.assign(new Error(`${mapping.targetEntity} imports are currently deferred. Choose an active canonical record type.`), { status: 409 });
        const staged = stageWorksheet(command.importId, profile, mapping, state.canonical);
        const retained = state.staging.filter(r => r.importId !== command.importId);
        state.staging = [...retained, ...staged];
        const sourceImport = state.imports.find(i => i.importId === command.importId);
        if (sourceImport) { sourceImport.status = "staged"; sourceImport.mappingId = mapping.mappingId; sourceImport.mappingVersion = mapping.version; }
        state.activity.push(activity(actor, "Records staged", command.importId, "spreadsheet", `${staged.length} record(s) staged`, correlationId));
      }
      if (command.action === "review") {
        if (command.decision === "approve" && !canApprove(actor.role)) throw Object.assign(new Error("Only an Integration Administrator may approve imports."), { status: 403 });
        const selected = state.staging.filter(r => command.stagingIds.includes(r.stagingId));
        if (command.decision === "approve" && selected.some(r => r.issues.some(i => i.severity === "blocking") || ["invalid", "conflict", "possible-duplicate"].includes(r.state))) throw new Error("Bulk approval cannot include blocked or unresolved duplicate records.");
        for (const record of selected) {
          if (command.decision === "approve") {
            resolveStagingReferences(record, state.canonical);
            const unresolvedReference = unresolvedRequiredReference(record);
            if (unresolvedReference) throw new Error(unresolvedReference);
            const canonical = canonicalFromStage(record, actor.uid);
            const existingMatches = state.canonical.filter(candidate => candidate.entityType === canonical.entityType && sameProviderIdentity(candidate.record, canonical.record));
            if (existingMatches.length > 1) throw new Error("Provider identity is attached to multiple canonical records. Administrator resolution is required.");
            const existing = existingMatches[0];
            if (existing) {
              existing.record = mergeProviderUpdate(existing.record, record.normalised, actor.uid);
              existing.dataHash = sha256(JSON.stringify(existing.record));
            }
            const validated = parseCanonical(canonical.entityType, existing?.record || canonical.record);
            if (!validated.success) throw new Error(`Canonical validation blocked ${record.stagingId}: ${validated.error.issues[0]?.message}`);
            record.state = "approved";
            const approved = resolveApprovedCanonicalLifecycle(
              existing || canonical,
              existing ? state.canonical : [...state.canonical, canonical],
              new Date().toISOString(),
            );
            if (existing) Object.assign(existing, approved);
            else state.canonical.push(approved);
          }
          if (command.decision === "exclude") { record.state = "excluded"; record.exclusionReason = command.reason || "Excluded during review"; }
          if (command.decision === "unresolved") record.state = "unresolved";
          if (command.decision === "resolve-new") { record.duplicateCandidates = []; record.state = record.issues.some(i => i.severity === "blocking") ? "invalid" : "ready"; }
          if (command.decision === "resolve-update") {
            if (!canApprove(actor.role)) throw Object.assign(new Error("Only an Integration Administrator may update canonical records."), { status: 403 });
            const candidate = record.duplicateCandidates[0], existing = candidate && state.canonical.find(r => r.canonicalId === candidate.canonicalId);
            if (!existing) throw new Error("The selected canonical match no longer exists.");
            existing.record = mergeProviderUpdate(existing.record, record.normalised, actor.uid);
            const validated = parseCanonical(existing.entityType, existing.record); if (!validated.success) throw new Error(`Matched update failed canonical validation: ${validated.error.issues[0]?.message}`);
            existing.dataHash = sha256(JSON.stringify(existing.record)); record.state = "approved";
          }
          record.reviewedBy = actor.uid; record.reviewedAt = new Date().toISOString();
        }
        state.activity.push(activity(actor, `Review: ${command.decision}`, command.stagingIds.join(","), "review", `${selected.length} record(s); ${command.reason || "no additional reason"}`, correlationId));
      }
      if (command.action === "correct") {
        const record = state.staging.find(r => r.stagingId === command.stagingId); if (!record) throw new Error("Staging record not found.");
        record.normalised = { ...record.normalised, ...command.patch }; record.reviewedBy = actor.uid; record.reviewedAt = new Date().toISOString();
        state.activity.push(activity(actor, "Staging correction", record.stagingId, "review", `Corrected: ${Object.keys(command.patch).join(", ")}`, correlationId));
      }
      if (command.action === "manifest") {
        if (!canApprove(actor.role)) throw Object.assign(new Error("Only an Integration Administrator may prepare promotion evidence."), { status: 403 });
        const manifest = createManifest(state, actor, command.target);
        state.manifests.push(manifest);
        saveLocalSnapshot(`generated-reports/${manifest.manifestId.replace(":", "-")}.json`, JSON.stringify(manifest, null, 2));
        state.activity.push(activity(actor, "Promotion manifest generated", manifest.manifestId, "local", manifest.valid ? "Dry run passed; no upload occurred." : `Dry run blocked: ${manifest.blockers.join(" ")}`, correlationId));
      }
      if (command.action === "reset-provider") {
        if (!canApprove(actor.role)) throw Object.assign(new Error("Only an Integration Administrator may reset local provider data."), { status: 403 });
        const removed = clearProviderData(state, command.provider);
        state.activity.push(activity(actor, "Local provider data reset", command.provider, "local-reset", `${removed.stagingRemoved} staged, ${removed.canonicalRemoved} canonical and ${removed.syncRunsRemoved} sync-run record(s) removed. Other providers and spreadsheet data were preserved.`, correlationId));
      }
    });
    return NextResponse.json({ state });
  } catch (error) { return errorResponse(error); }
}


async function prepareProviderSync(provider: SyncProvider, full: boolean, state: Awaited<ReturnType<typeof getState>>, runId: string, report: import("@/lib/sync-service").ReportSyncProgress): Promise<PreparedSync> {
  const records: StagingRecord[] = [];
  let mode: "fixture" | "live-local" = "fixture";
  let status: "succeeded" | "partial" = "succeeded";
  let sourceSnapshotReference: string | undefined, sourceSnapshotHash: string | undefined;
  if (provider === "brighthr") {
    const data = await fetchBrightHr(report); mode = data.mode as "fixture" | "live-local";
    const capturedAt = new Date().toISOString(); const sourceEvidence = JSON.stringify({ schemaVersion: "fika.brighthr-source-snapshot.v1", capturedAt, mode, employees: data.employees, absences: data.absences }); sourceSnapshotHash = sha256(sourceEvidence); sourceSnapshotReference = saveLocalSnapshot(`source-snapshots/brighthr/${runId.replace(":", "-")}.json`, sourceEvidence);
    const normalisedEmployees = data.employees.map(normaliseBrightEmployee);
    const nameCounts = new Map<string, number>();
    for (const employee of normalisedEmployees) { const key = normaliseLegendName(employee.displayName); nameCounts.set(key, (nameCounts.get(key) || 0) + 1); }
    const rota = loadRotaEnrichment();
    const reviewedMappings = new Map((await confirmedSourceMappings("rota")).filter(mapping => mapping.oplocId).map(mapping => [String(mapping.sourceLabel || mapping.sourceIdentifier).toLowerCase(), String(mapping.oplocId)]));
    for (const n of normalisedEmployees) { const key = normaliseLegendName(n.displayName); const rotaEnrichment = matchRotaLegend(n.displayName, rota, (nameCounts.get(key) || 0) > 1); const reviewedRotaReferences = rotaEnrichment.rotaSiteReferences.map(reference => ({ ...reference, ...(reviewedMappings.get(reference.name.toLowerCase()) ? { reviewedOplocId: reviewedMappings.get(reference.name.toLowerCase()) } : {}) })); records.push(providerStage(runId, "Legend", n.externalId, { displayName: n.displayName, workEmail: n.workEmail, jobTitle: n.jobTitle, employmentState: n.employmentState, active: n.active, terminated: n.terminated, terminationDate: n.terminationDate, workLocationReferences: n.workLocationReferences, workLocationMappingStatus: n.workLocationReferences.length ? "provider-reference-requires-oploc-review" : "not-supplied-by-provider", ...rotaEnrichment, rotaSiteReferences: reviewedRotaReferences }, state, "brighthr", n.providerVersion)); }
    for (const n of normalisedEmployees) {
      const linkedLegends = state.canonical.filter(candidate => candidate.entityType === "Legend" && Array.isArray(candidate.record.externalIdentities) && candidate.record.externalIdentities.some(identity => identity && typeof identity === "object" && String((identity as Record<string, unknown>).provider || "").toLowerCase() === "brighthr" && String((identity as Record<string, unknown>).externalId || "") === n.externalId));
      records.push(providerStage(runId, "Employment", n.externalId, { legendId: linkedLegends.length === 1 ? linkedLegends[0].canonicalId : "", legendExternalId: n.externalId, employmentState: n.employmentState, ...(n.startDate ? { startDate: n.startDate } : {}), ...(n.terminationDate ? { terminationDate: n.terminationDate } : {}), ...(n.jobTitle ? { contractualJobTitle: n.jobTitle } : {}) }, state, "brighthr", n.providerVersion));
    }
    const legendByExternal = new Map(records.map(record => [String(record.raw.externalId), record]));
    for (const absence of data.absences) { const n = normaliseBrightAbsence(absence); const legend = legendByExternal.get(n.employeeExternalId); records.push(providerStage(runId, "Absence", n.externalId, { legendId: "", legendExternalId: legend ? n.employeeExternalId : "", startDate: n.startDate, endDate: n.endDate, absenceType: n.absenceType, approvalState: n.approvalState }, state, "brighthr")); }
    status = "partial" in data && data.partial ? "partial" : "succeeded";
  } else {
    const squareObjectTypes = ["CATEGORY", ...(!isImportDeferred("Till Item") || !isImportDeferred("Till Item Variation") ? ["ITEM", "TAX", "MODIFIER_LIST"] : [])];
    const data = await fetchSquare(full, report, squareObjectTypes); mode = data.mode as "fixture" | "live-local"; const objects = squareObjects(data);
    for (const location of objects.locations) records.push(providerStage(runId, "Site", location.externalId, { name: location.name, address: location.address, businessName: location.businessName, description: location.description, timezone: location.timezone, currency: location.currency, country: location.country, capabilities: location.capabilities, active: location.active, squareLocationStatus: location.status, providerUpdatedAt: location.providerUpdatedAt }, state, "square", location.providerVersion, location.sourceMetadata));
    for (const category of objects.categories) records.push(providerStage(runId, "Product Category", category.externalId, { name: category.name, categoryType: category.categoryType, parentCategoryExternalId: category.parentCategoryExternalId, ordinal: category.ordinal, providerUpdatedAt: category.providerUpdatedAt, active: category.active }, state, "square", category.providerVersion, category.sourceMetadata));
    if (!isImportDeferred("Till Item")) for (const item of objects.items) records.push(providerStage(runId, "Till Item", item.externalId, { name: item.name, description: item.description, abbreviation: item.abbreviation, productType: item.productType, active: item.active, providerUpdatedAt: item.providerUpdatedAt, categoryExternalId: item.categoryExternalId, categoryExternalIds: item.categoryExternalIds, categoryReferences: item.categoryReferences, taxIds: item.taxIds, taxReferences: item.taxReferences, modifierListIds: item.modifierListIds, modifierListReferences: item.modifierListReferences, locationAvailability: item.locationAvailability, availableOnline: item.availableOnline, availableForPickup: item.availableForPickup, availableElectronically: item.availableElectronically, imageIds: item.imageIds, variationCount: item.variationCount }, state, "square", item.providerVersion, item.sourceMetadata));
    if (!isImportDeferred("Till Item Variation")) for (const variation of objects.variations) records.push(providerStage(runId, "Till Item Variation", variation.externalId, { name: variation.name, sku: variation.sku, pricingType: variation.pricingType, tillItemId: "", tillItemExternalId: variation.itemExternalId, active: variation.active, providerUpdatedAt: variation.providerUpdatedAt, basePrice: variation.basePrice, locationPrices: variation.locationPrices, sitePrices: [], locationIds: variation.locationIds, absentAtLocationIds: variation.absentAtLocationIds, locationAvailability: variation.locationAvailability, sellable: variation.sellable, stockable: variation.stockable, serviceDuration: variation.serviceDuration, measurementUnitExternalId: variation.measurementUnitExternalId, imageIds: variation.imageIds }, state, "square", variation.providerVersion, variation.sourceMetadata));
  }
  return { mode, status, records, sourceSnapshotReference, sourceSnapshotHash, counts: { staged: records.length, ready: records.filter(record => record.state === "ready").length, invalid: records.filter(record => record.state === "invalid").length, duplicates: records.filter(record => record.state === "possible-duplicate").length } };
}

function providerStage(importId: string, entityType: CanonicalEntityType, externalId: string, normalised: Record<string, unknown>, state: Awaited<ReturnType<typeof getState>>, provider: "brighthr" | "square", providerVersion = "", sourceMetadata: Record<string, unknown> = {}) : StagingRecord {
  const identity = classifyProviderIdentity(state.canonical, entityType, provider, externalId);
  const issues = Object.entries(normalised).filter(([key, value]) => ["displayName", "name", "startDate", "endDate"].includes(key) && !String(value ?? "").trim()).map(([key], i) => ({ issueId: stableId("issue", `${importId}:${externalId}:${i}`), severity: "blocking" as const, code: "REQUIRED_FIELD", field: key, message: `${key} is required.` }));
  if (identity.kind === "conflict") issues.push({ issueId: stableId("issue", `${importId}:${externalId}:provider-identity-conflict`), severity: "blocking", code: "PROVIDER_IDENTITY_CONFLICT", field: "externalIdentities", message: `${provider} identity is attached to multiple canonical records. Administrator resolution is required.` });
  const conflicts = identity.kind === "conflict" ? identity.matches.map(record => ({ canonicalId: record.canonicalId, reason: `${provider} identity is attached to multiple canonical records`, confidence: 1 })) : [];
  return { stagingId: stableId("staging", `${provider}:${externalId}`), importId, sourceRow: 1, entityType, raw: { provider, externalId, providerVersion, ...sourceMetadata }, normalised: { ...normalised, externalIdentities: [{ provider, externalId, providerVersion }] }, issues, duplicateCandidates: conflicts, state: identity.kind === "conflict" ? "conflict" : issues.length ? "invalid" : "ready", mappingVersion: 1 };
}
