import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import { assertPermission } from "./authmod";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { saveCanonicalChange } from "./canonical-record-service";
import { isTerminatedLegend } from "./connection-rules";
import { parseCanonical, type CanonicalEntityType } from "./schemas";
import {
  staffingCoverage,
  validateSiteRoleAssignment,
  validateStaffingRequirement,
  type SiteRoleAssignmentValues,
  type StaffingRequirementValues,
} from "./site-staffing-development";
import { sha256 } from "./profiler";
import type { CanonicalRecord } from "./types";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");
const menuProductionRouting = () => db.collection("integrationHubHospitalityMenuProductionRouting");

export type ProductionDashboardView = "liana" | "craig" | "site_manager";

// Transitional provider identities retained by older hospitality hand-offs.
// These are stable source keys, not display-name matching. They remain only
// until those historical offerings are reconciled to canonical Menu Items.
const LEGACY_HOSPITALITY_MENU_ROUTING: Record<string, ProductionDashboardView[]> = {
  "deli-style-sandwich": ["liana"],
  // The canonical MNK migration retained the source key with underscores.
  // Keep both spellings while restored/local workspaces catch up with their
  // explicit Connections routing records.
  "deli_sandwich_lunch": ["liana"],
  "exotic-fruit-box": ["craig"],
  "exotic_fruit_box": ["craig"],
  "mini-traybake-bites": ["craig"],
  "mini_pastries": ["craig"],
  "filled_savoury_croissant": ["craig"],
  "cookie_box": ["craig"],
  "large_pastries": ["craig"],
  "tray_bake_box": ["craig"],
  "vegan_savoury_croissant": ["craig"],
};

/** Read-only projection consumed by the CPU dashboards. */
export async function hospitalityMenuProductionRouting(menuItemIds?: string[]): Promise<Record<string, ProductionDashboardView[]>> {
  const wanted = menuItemIds ? [...new Set(menuItemIds.filter(Boolean))] : undefined;
  const snapshot = wanted
    ? await Promise.all(wanted.map(id => menuProductionRouting().doc(stableDocumentId(id)).get()))
    : await menuProductionRouting().get();
  const documents = Array.isArray(snapshot) ? snapshot.filter(item => item.exists) : snapshot.docs;
  const saved = Object.fromEntries(documents.map(document => {
    const data = document.data() || {};
    const views = Array.isArray(data.views)
      ? data.views.filter((view: unknown): view is ProductionDashboardView => view === "liana" || view === "craig" || view === "site_manager")
      : [];
    return [String(data.menuItemId || document.id), Array.from(new Set(views))];
  }));
  // Keep historical provider lines visible in the intended role view when a
  // restored local workspace has not yet recreated its explicit routing
  // decisions. Explicit Connections decisions always win.
  const routing: Record<string, ProductionDashboardView[]> = {
    ...LEGACY_HOSPITALITY_MENU_ROUTING,
    ...saved,
  };

  // Current MNK production hand-offs carry canonical IDs whose suffix is the
  // exact legacy source key. Add those aliases without a broad canonical
  // collection read (which is unsafe for large local workspaces).
  for (const [sourceKey, views] of Object.entries(routing)) {
    const canonicalId = `hospitality-menu-item:mnk:${sourceKey}`;
    if (!routing[canonicalId]) routing[canonicalId] = views;
  }

  return routing;
}

export type ConnectionCommand =
  | {
      action: "merge-hospitality-menu-items";
      sourceMenuItemId: string;
      survivorMenuItemId: string;
    }
  | {
      action: "save-hospitality-menu-production-routing";
      menuItemId: string;
      views: Array<"liana" | "craig" | "site_manager">;
    }
  | {
      action: "save-employment-connection";
      canonicalId?: string;
      expectedVersion?: number;
      legendId: string;
      employmentState: string;
      startDate?: string;
      terminationDate?: string;
      contractualJobTitle?: string;
      contractHours?: number;
    }
  | {
      action: "save-operational-assignment";
      canonicalId?: string;
      expectedVersion?: number;
      legendId: string;
      oplocId: string;
      assignmentRole: string;
      designation: "primary" | "secondary";
      effectiveFrom: string;
      effectiveTo?: string;
      lifecycleState?: "active" | "ended" | "archived";
    }
  | {
      action: "save-staffing-role";
      canonicalId?: string;
      expectedVersion?: number;
      name: string;
      description?: string;
      active: boolean;
    }
  | ({
      action: "save-site-staffing-requirement";
      canonicalId?: string;
      expectedVersion?: number;
    } & StaffingRequirementValues)
  | ({
      action: "save-site-role-assignment";
      canonicalId?: string;
      expectedVersion?: number;
    } & SiteRoleAssignmentValues)
  | {
      action: "remove-site-role-assignment";
      canonicalId: string;
      expectedVersion: number;
    };

export async function connectionsOverview() {
  const [snapshot, mappingsSnapshot, auditSnapshot, routingSnapshot] = await Promise.all([
    canonical().get(),
    db.collection("integrationHubSourceMappings").get(),
    db.collection("integrationHubGovernanceAudit").get(),
    menuProductionRouting().get(),
  ]);
  const records = snapshot.docs.map(
    (document) => document.data() as CanonicalRecord,
  );
  const menuItems = records
    .filter(record => record.entityType === "Hospitality Menu Item")
    .map(record => ({
      canonicalId: record.canonicalId,
      name: String(record.record.name || record.canonicalId),
      category: String(record.record.category || "Uncategorised"),
      description: String(record.record.description || ""),
      dietaryInformation: Array.isArray(record.record.dietaryInformation) ? record.record.dietaryInformation.map(String) : [],
      allergenInformation: Array.isArray(record.record.allergenInformation) ? record.record.allergenInformation.map(String) : [],
      providerMappings: Array.isArray(record.record.providerMappings) ? record.record.providerMappings : [],
      version: Number(record.record.version || 1),
      lifecycleState: String(record.record.lifecycleState || "active"),
      publicationStatus: record.publicationStatus,
      scopes: records.filter(candidate => candidate.entityType === "Hospitality Menu Offering" && candidate.record.hospitalityMenuItemId === record.canonicalId).map(offering => ({ oplocId: String(offering.record.oplocId), label: String(records.find(candidate => candidate.canonicalId === offering.record.oplocId)?.record.approvedName || offering.record.oplocId), operationalAreaId: offering.record.operationalAreaId ? String(offering.record.operationalAreaId) : undefined })).filter((scope, index, all) => all.findIndex(candidate => candidate.oplocId === scope.oplocId && candidate.operationalAreaId === scope.operationalAreaId) === index),
      views: ((routingSnapshot.docs.find(doc => doc.id === stableDocumentId(record.canonicalId))?.data()?.views || []) as string[]).filter((view): view is "liana" | "craig" | "site_manager" => view === "liana" || view === "craig" || view === "site_manager"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const employments = records.filter(
    (record) =>
      record.entityType === "Employment" &&
      record.lifecycleStatus !== "archived",
  );
  const legendRecords = records.filter(
    (record) =>
      record.entityType === "Legend" && record.lifecycleStatus !== "archived",
  );
  const legends = legendRecords
    .map((record) => ({
      canonicalId: record.canonicalId,
      label: String(record.record.preferredName || record.record.displayName),
      terminated: isTerminatedLegend(record, employments),
    }))
    .sort(byLabel);
  const oplocRecords = records.filter(
    (record) =>
      record.entityType === "OPLOC" &&
      record.lifecycleStatus !== "archived" &&
      record.record.lifecycleState === "active",
  );
  const oplocs = oplocRecords
    .map((record) => ({
      canonicalId: record.canonicalId,
      label: String(record.record.approvedName || record.canonicalId),
    }))
    .sort(byLabel);
  const roleRecords = records.filter(
    (record) =>
      record.entityType === "Staffing Role" &&
      record.lifecycleStatus !== "archived",
  );
  const staffingRoles = roleRecords
    .map((record) => ({
      canonicalId: record.canonicalId,
      name: String(record.record.name || record.canonicalId),
      label: String(record.record.name || record.canonicalId),
      description: optionalString(record.record.description),
      active: record.record.active !== false,
      version: Number(record.record.version || 0),
      development: true as const,
    }))
    .sort(byLabel);
  const legendLabels = new Map(
    legends.map((record) => [record.canonicalId, record.label]),
  );
  const oplocLabels = new Map(
    oplocs.map((record) => [record.canonicalId, record.label]),
  );
  const roleLabels = new Map(
    staffingRoles.map((record) => [record.canonicalId, record.label]),
  );
  const employmentConnections = employments
    .map((record) => ({
      canonicalId: record.canonicalId,
      legendId: String(record.record.legendId || ""),
      legendLabel:
        legendLabels.get(String(record.record.legendId || "")) ||
        "Archived or unavailable Legend",
      employmentState: String(record.record.employmentState || ""),
      startDate: optionalString(record.record.startDate),
      terminationDate: optionalString(record.record.terminationDate),
      contractualJobTitle: optionalString(record.record.contractualJobTitle),
      lifecycleStatus: record.lifecycleStatus || "needs-review",
      version: Number(record.record.version || 0),
      readOnlyEvidence: true as const,
    }))
    .sort((left, right) =>
      left.legendLabel.localeCompare(right.legendLabel),
    );
  const assignments = mapOperationalAssignments(
    records,
    legendLabels,
    oplocLabels,
  );
  const requirementRecords = records.filter(
    (record) =>
      record.entityType === "Site Staffing Requirement" &&
      record.lifecycleStatus !== "archived",
  );
  const siteAssignmentRecords = records.filter(
    (record) =>
      record.entityType === "Site Role Assignment" &&
      record.lifecycleStatus !== "archived",
  );
  const today = new Date().toISOString().slice(0, 10);
  const siteRoleAssignments = siteAssignmentRecords
    .map((record) => ({
      canonicalId: record.canonicalId,
      legendId: String(record.record.legendId || ""),
      legendLabel:
        legendLabels.get(String(record.record.legendId || "")) ||
        "Archived or unavailable Legend",
      oplocId: String(record.record.oplocId || ""),
      oplocLabel:
        oplocLabels.get(String(record.record.oplocId || "")) ||
        "Archived or unavailable OPLOC",
      staffingRoleId: String(record.record.staffingRoleId || ""),
      staffingRoleLabel:
        roleLabels.get(String(record.record.staffingRoleId || "")) ||
        "Inactive or unavailable role",
      effectiveFrom: String(record.record.effectiveFrom || ""),
      effectiveTo: optionalString(record.record.effectiveTo),
      primaryLocation: record.record.primaryLocation === true,
      lifecycleState: String(record.record.lifecycleState || "active") as
        | "active"
        | "ended",
      activeNow:
        String(record.record.lifecycleState || "active") === "active" &&
        String(record.record.effectiveFrom || "") <= today &&
        (!record.record.effectiveTo || String(record.record.effectiveTo) >= today),
      version: Number(record.record.version || 0),
      development: true as const,
    }))
    .sort(
      (left, right) =>
        left.oplocLabel.localeCompare(right.oplocLabel) ||
        left.staffingRoleLabel.localeCompare(right.staffingRoleLabel) ||
        left.legendLabel.localeCompare(right.legendLabel),
    );
  const siteStaffingRequirements = requirementRecords
    .map((record) => {
      const coverage = staffingCoverage(record, siteAssignmentRecords, today);
      return {
        canonicalId: record.canonicalId,
        oplocId: String(record.record.oplocId || ""),
        oplocLabel:
          oplocLabels.get(String(record.record.oplocId || "")) ||
          "Archived or unavailable OPLOC",
        staffingRoleId: String(record.record.staffingRoleId || ""),
        staffingRoleLabel:
          roleLabels.get(String(record.record.staffingRoleId || "")) ||
          "Inactive or unavailable role",
        requiredHeadcount: Number(record.record.requiredHeadcount || 0),
        effectiveFrom: String(record.record.effectiveFrom || ""),
        effectiveTo: optionalString(record.record.effectiveTo),
        notes: optionalString(record.record.notes),
        activeNow:
          String(record.record.effectiveFrom || "") <= today &&
          (!record.record.effectiveTo ||
            String(record.record.effectiveTo) >= today),
        version: Number(record.record.version || 0),
        development: true as const,
        ...coverage,
      };
    })
    .sort(
      (left, right) =>
        left.oplocLabel.localeCompare(right.oplocLabel) ||
        left.staffingRoleLabel.localeCompare(right.staffingRoleLabel),
    );
  const areas = records.filter(
    (record) =>
      record.entityType === "Operational Area" &&
      record.lifecycleStatus !== "archived",
  );
  const serviceArrangements = records.filter(
    (record) =>
      record.entityType === "Service Arrangement" &&
      record.lifecycleStatus !== "archived" &&
      record.record.lifecycleState === "active",
  );
  const enabledCapabilities = records.filter(
    (record) =>
      record.entityType === "Capability Enablement" &&
      record.lifecycleStatus !== "archived" &&
      record.record.state === "enabled",
  );
  const capabilityNames = new Map(
    records
      .filter((record) => record.entityType === "Operational Capability")
      .map((record) => [
        record.canonicalId,
        String(record.record.capabilityName || record.canonicalId),
      ]),
  );
  const sourceMappings = mappingsSnapshot.docs.map((document) => document.data());
  const audits = auditSnapshot.docs.map((document) => document.data());
  const enrichedOplocs = oplocs.map((oploc) => {
    const areaCount = areas.filter(
      (area) =>
        area.record.oplocId === oploc.canonicalId &&
        area.record.lifecycleState === "active",
    ).length;
    const activeStaffing = siteRoleAssignments.filter(
      (assignment) => assignment.oplocId === oploc.canonicalId && assignment.activeNow,
    ).length;
    const activeLegacyAssignments = assignments.filter(
      (assignment) =>
        assignment.oplocId === oploc.canonicalId &&
        assignment.lifecycleState === "active",
    ).length;
    const providerMappings = sourceMappings
      .filter((mapping) => mapping.oplocId === oploc.canonicalId)
      .map((mapping) => ({
        mappingId: String(mapping.mappingId || ""),
        sourceProvider: String(mapping.sourceProvider || ""),
        sourceEntityType: String(mapping.sourceEntityType || ""),
        sourceIdentifier: String(mapping.sourceIdentifier || ""),
        sourceLabel: optionalString(mapping.sourceLabel),
        mappingStatus: String(mapping.mappingStatus || "unresolved"),
        operationalAreaId: optionalString(mapping.targetCanonicalId),
      }));
    const capabilities = enabledCapabilities
      .filter((record) => record.record.oplocId === oploc.canonicalId)
      .map((record) =>
        capabilityNames.get(String(record.record.capabilityId || "")) ||
        "Unavailable capability",
      );
    const lifecycleRecord = oplocRecords.find(
      (record) => record.canonicalId === oploc.canonicalId,
    )!;
    return {
      ...oploc,
      locationType: String(lifecycleRecord.record.primaryLocationType || ""),
      lifecycleState: String(lifecycleRecord.record.lifecycleState || "active"),
      aliases: Array.isArray(lifecycleRecord.record.aliases)
        ? lifecycleRecord.record.aliases
        : [],
      clientLabel: undefined as string | undefined,
      areaCount,
      serviceCount: serviceArrangements.filter(
        (service) => service.record.oplocId === oploc.canonicalId,
      ).length,
      activeConnections: activeStaffing + activeLegacyAssignments + providerMappings.length + capabilities.length + serviceArrangements.filter((service) => service.record.oplocId === oploc.canonicalId).length,
      capabilities,
      providerMappings,
      connectionHealth:
        areaCount || activeStaffing || providerMappings.length || capabilities.length
          ? "configured"
          : "setup-needed",
      history: audits
        .filter(
          (audit) =>
            audit.entityReference === oploc.canonicalId ||
            audit.oplocId === oploc.canonicalId,
        )
        .sort((left, right) =>
          String(right.timestamp || "").localeCompare(String(left.timestamp || "")),
        )
        .slice(0, 20)
        .map((audit) => ({
          action: String(audit.action || "Change recorded"),
          timestamp: String(audit.timestamp || ""),
          entityReference: String(audit.entityReference || ""),
        })),
    };
  });
  return {
    today,
    legends,
    oplocs: enrichedOplocs,
    employments: employmentConnections,
    assignments,
    staffingRoles,
    siteStaffingRequirements,
    siteRoleAssignments,
    menuItems,
    siteRoleEstablishment: {
      governed: false,
      developmentAvailable: true,
      message:
        "Site staffing is available as an explicitly Development workflow and has not been promoted into Accepted Canon.",
    },
  };
}

export async function saveConnectionCommand(
  actor: Actor,
  command: ConnectionCommand,
) {
  if (command.action === "merge-hospitality-menu-items") {
    assertPermission(actor, "canonical.edit");
    if (command.sourceMenuItemId === command.survivorMenuItemId) throw new Error("Choose two different Menu Items to merge.");
    const now = new Date().toISOString();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(canonical());
      const records = snapshot.docs.map(document => document.data() as CanonicalRecord);
      const source = records.find(record => record.canonicalId === command.sourceMenuItemId);
      const survivor = records.find(record => record.canonicalId === command.survivorMenuItemId);
      if (!source || source.entityType !== "Hospitality Menu Item" || !survivor || survivor.entityType !== "Hospitality Menu Item") throw new Error("Both selected records must be Hospitality Menu Items.");
      if (source.record.lifecycleState !== "active") throw new Error("Only an active source Menu Item can be merged.");
      const sourceOfferings = records.filter(record => record.entityType === "Hospitality Menu Offering" && record.record.hospitalityMenuItemId === source.canonicalId);
      const survivorOfferings = records.filter(record => record.entityType === "Hospitality Menu Offering" && record.record.hospitalityMenuItemId === survivor.canonicalId);
      const existingKeys = new Set(survivorOfferings.map(record => `${record.record.oplocId}|${record.record.operationalAreaId || ""}|${record.record.offeringMode}`));
      for (const offering of sourceOfferings) {
        const key = `${offering.record.oplocId}|${offering.record.operationalAreaId || ""}|${offering.record.offeringMode}`;
        if (existingKeys.has(key)) throw new Error(`The merge would create a duplicate offering for ${offering.record.oplocId}. Resolve that site offering first.`);
        existingKeys.add(key);
      }
      const identities = new Map<string, Record<string, unknown>>();
      const survivorMappings = (Array.isArray(survivor.record.providerMappings) ? survivor.record.providerMappings : []) as Record<string, unknown>[];
      const sourceMappings = (Array.isArray(source.record.providerMappings) ? source.record.providerMappings : []) as Record<string, unknown>[];
      for (const item of [...survivorMappings, ...sourceMappings]) identities.set(`${item.provider}|${item.sourceItemId}`, item);
      const survivorRecord = { ...survivor.record, providerMappings: [...identities.values()], version: Number(survivor.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid };
      const sourceRecord = { ...source.record, lifecycleState: "archived", version: Number(source.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid };
      const survivorParsed = parseCanonical("Hospitality Menu Item", survivorRecord); const sourceParsed = parseCanonical("Hospitality Menu Item", sourceRecord);
      if (!survivorParsed.success || !sourceParsed.success) throw new Error("The merge failed Menu Item validation.");
      transaction.set(canonical().doc(stableDocumentId(survivor.canonicalId)), { ...survivor, record: survivorRecord, dataHash: sha256(JSON.stringify(survivorRecord)) });
      transaction.set(canonical().doc(stableDocumentId(source.canonicalId)), { ...source, record: sourceRecord, dataHash: sha256(JSON.stringify(sourceRecord)) });
      transaction.set(db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(source.canonicalId)), { sourceMenuItemId: source.canonicalId, survivorMenuItemId: survivor.canonicalId, mergedAt: now, mergedBy: actor.uid }, { merge: true });
      for (const offering of sourceOfferings) {
        const nextRecord = { ...offering.record, hospitalityMenuItemId: survivor.canonicalId, version: Number(offering.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid };
        const parsed = parseCanonical("Hospitality Menu Offering", nextRecord); if (!parsed.success) throw new Error("The merge would make a scoped offering invalid.");
        transaction.set(canonical().doc(stableDocumentId(offering.canonicalId)), { ...offering, record: nextRecord, dataHash: sha256(JSON.stringify(nextRecord)) });
      }
      transaction.create(audit().doc(crypto.randomUUID()), { action: "Hospitality Menu Items merged", entityReference: survivor.canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: `${source.canonicalId} was explicitly merged into the surviving Menu Item.` });
    });
  } else if (command.action === "save-hospitality-menu-production-routing") {
    assertPermission(actor, "canonical.edit");
    const item = await canonical().doc(stableDocumentId(command.menuItemId)).get();
    if (!item.exists || (item.data() as CanonicalRecord).entityType !== "Hospitality Menu Item") throw new Error("Choose a valid Hospitality Menu Item.");
    const now = new Date().toISOString();
    const ref = menuProductionRouting().doc(stableDocumentId(command.menuItemId));
    const current = (await ref.get()).data() || {};
    const views = Array.from(new Set(command.views));
    await db.runTransaction(async transaction => {
      transaction.set(ref, { menuItemId: command.menuItemId, views, version: Number(current.version || 0) + 1, createdAt: current.createdAt || now, updatedAt: now, updatedBy: actor.uid }, { merge: true });
      transaction.create(audit().doc(crypto.randomUUID()), { action: "Hospitality Menu Item production view routing updated", entityReference: command.menuItemId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: `Assigned to ${views.length ? views.join(" and ") : "no"} production dashboard view${views.length === 1 ? "" : "s"}.` });
    });
  } else if (command.action === "save-employment-connection") {
    // Retained for compatibility with the earlier server command. The Site
    // Staffing UI treats Employment as read-only evidence.
    assertPermission(actor, "employment.manage");
    const canonicalId = command.canonicalId || generateCanonicalId("Employment");
    await saveCanonicalChange(actor, {
      entityType: "Employment",
      canonicalId,
      expectedVersion: command.canonicalId ? command.expectedVersion : 0,
      values: command,
      decisionReason: "Updated the reviewed Employment connection through the Connections workspace.",
    });
  } else if (command.action === "save-operational-assignment") {
    assertPermission(actor, "operational-assignment.approve");
    const canonicalId =
      command.canonicalId || generateCanonicalId("Operational Assignment");
    await saveCanonicalChange(actor, {
      entityType: "Operational Assignment",
      canonicalId,
      expectedVersion: command.canonicalId ? command.expectedVersion : 0,
      values: { ...command, evidenceReferences: [] },
      decisionReason: "Updated the reviewed Operational Assignment through the Connections workspace.",
    });
  } else if (command.action === "remove-site-role-assignment") {
    assertPermission(actor, "operational-assignment.approve");
    await removeDevelopmentAssignment(actor, command);
  } else {
    assertPermission(actor, "operational-assignment.approve");
    await saveDevelopmentStaffingRecord(actor, command);
  }
  return connectionsOverview();
}

async function saveDevelopmentStaffingRecord(
  actor: Actor,
  command: Exclude<
    ConnectionCommand,
    | { action: "save-employment-connection" }
    | { action: "save-operational-assignment" }
    | { action: "merge-hospitality-menu-items" }
    | { action: "save-hospitality-menu-production-routing" }
    | { action: "remove-site-role-assignment" }
  >,
) {
  const entityType = developmentEntityType(command.action);
  const canonicalId =
    command.canonicalId || generateCanonicalId(entityType);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(canonical());
    const records = snapshot.docs.map(
      (document) => document.data() as CanonicalRecord,
    );
    const current = records.find((record) => record.canonicalId === canonicalId);
    assertDevelopmentVersion(current, command.expectedVersion);
    const now = new Date().toISOString();
    const base = current
      ? {
          ...structuredClone(current.record),
          version: Number(current.record.version || 0) + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        }
      : {
          schemaVersion: "0.1.0",
          version: 1,
          createdAt: now,
          createdBy: actor.uid,
          updatedAt: now,
          updatedBy: actor.uid,
          active: true,
          externalIdentities: [],
          provenanceIds: [],
          ownership: {
            providerOwned: {},
            fikaOwned: { developmentModel: true },
          },
        };
    let record: Record<string, unknown>;
    let warnings: string[] = [];
    if (command.action === "save-staffing-role") {
      record = {
        ...base,
        entityType,
        canonicalId,
        name: command.name.trim(),
        ...(command.description?.trim()
          ? { description: command.description.trim() }
          : {}),
        active: command.active,
      };
      if (!command.description?.trim()) delete record.description;
    } else if (command.action === "save-site-staffing-requirement") {
      validateStaffingRequirement({
        values: command,
        currentId: current?.canonicalId,
        oplocs: records.filter((record) => record.entityType === "OPLOC"),
        roles: records.filter((record) => record.entityType === "Staffing Role"),
        requirements: records.filter(
          (record) => record.entityType === "Site Staffing Requirement",
        ),
      });
      record = {
        ...base,
        entityType,
        canonicalId,
        oplocId: command.oplocId,
        staffingRoleId: command.staffingRoleId,
        requiredHeadcount: command.requiredHeadcount,
        effectiveFrom: command.effectiveFrom,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
        ...(command.notes?.trim() ? { notes: command.notes.trim() } : {}),
      };
      if (!command.effectiveTo) delete record.effectiveTo;
      if (!command.notes?.trim()) delete record.notes;
    } else {
      warnings = validateSiteRoleAssignment({
        values: command,
        currentId: current?.canonicalId,
        legends: records.filter((record) => record.entityType === "Legend"),
        employments: records.filter((record) => record.entityType === "Employment"),
        oplocs: records.filter((record) => record.entityType === "OPLOC"),
        roles: records.filter((record) => record.entityType === "Staffing Role"),
        assignments: records.filter(
          (record) => record.entityType === "Site Role Assignment",
        ),
        requirements: records.filter(
          (record) => record.entityType === "Site Staffing Requirement",
        ),
      });
      record = {
        ...base,
        entityType,
        canonicalId,
        legendId: command.legendId,
        oplocId: command.oplocId,
        staffingRoleId: command.staffingRoleId,
        effectiveFrom: command.effectiveFrom,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
        primaryLocation: command.primaryLocation,
        lifecycleState: command.lifecycleState,
      };
      if (!command.effectiveTo) delete record.effectiveTo;
    }
    const parsed = parseCanonical(entityType, record);
    if (!parsed.success)
      throw Object.assign(
        new Error(
          parsed.error.issues[0]?.message ||
            `${entityType} failed development validation.`,
        ),
        { status: 400 },
      );
    const next: CanonicalRecord = {
      ...(current || { canonicalId, entityType, dataHash: "" }),
      canonicalId,
      entityType,
      record,
      dataHash: sha256(JSON.stringify(record)),
      lifecycleStatus: "needs-review",
    };
    writeDevelopmentHistory(
      transaction,
      actor,
      current || null,
      next,
      warnings,
      now,
    );
  });
}

async function removeDevelopmentAssignment(
  actor: Actor,
  command: Extract<
    ConnectionCommand,
    { action: "remove-site-role-assignment" }
  >,
) {
  await db.runTransaction(async (transaction) => {
    const reference = canonical().doc(stableDocumentId(command.canonicalId));
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists)
      throw Object.assign(new Error("The assignment no longer exists."), {
        status: 409,
      });
    const current = snapshot.data() as CanonicalRecord;
    if (current.entityType !== "Site Role Assignment")
      throw Object.assign(
        new Error("Only a development Site Role Assignment may be removed here."),
        { status: 400 },
      );
    assertDevelopmentVersion(current, command.expectedVersion);
    if (current.publicationStatus)
      throw Object.assign(
        new Error("A published record cannot use the development removal path."),
        { status: 409 },
      );
    const now = new Date().toISOString();
    transaction.delete(reference);
    writeRevisionAndAudit(transaction, actor, current, null, now, [], "Removed an erroneous development Site Role Assignment");
  });
}

function writeDevelopmentHistory(
  transaction: FirebaseFirestore.Transaction,
  actor: Actor,
  current: CanonicalRecord | null,
  next: CanonicalRecord,
  warnings: string[],
  now: string,
) {
  transaction.set(
    canonical().doc(stableDocumentId(next.canonicalId)),
    next,
  );
  writeRevisionAndAudit(
    transaction,
    actor,
    current,
    next,
    now,
    warnings,
    current ? `Updated development ${next.entityType}` : `Created development ${next.entityType}`,
  );
}

function writeRevisionAndAudit(
  transaction: FirebaseFirestore.Transaction,
  actor: Actor,
  current: CanonicalRecord | null,
  next: CanonicalRecord | null,
  now: string,
  warnings: string[],
  action: string,
) {
  const canonicalId = next?.canonicalId || current!.canonicalId;
  const entityType = next?.entityType || current!.entityType;
  const version = Number(next?.record.version || current!.record.version || 0);
  const revisionId = `canonical-revision:${stableDocumentId(`${canonicalId}:${version}:${next ? "saved" : "removed"}`)}`;
  transaction.set(revisions().doc(stableDocumentId(revisionId)), {
    revisionId,
    canonicalId,
    entityType,
    version,
    previous: current,
    current: next,
    actorId: actor.uid,
    actorName: actor.name,
    reason: action,
    warnings,
    recordedAt: now,
  });
  const auditId = crypto.randomUUID();
  transaction.set(audit().doc(auditId), {
    auditId,
    action,
    entityReference: canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: now,
    developmentModel: true,
    warnings,
  });
}

function assertDevelopmentVersion(
  current: CanonicalRecord | undefined,
  expectedVersion: number | undefined,
) {
  if (!current && expectedVersion && expectedVersion !== 0)
    throw Object.assign(new Error("The development record no longer exists."), {
      status: 409,
    });
  if (current && Number(current.record.version || 0) !== expectedVersion)
    throw Object.assign(
      new Error(
        "This staffing record changed after it was opened. Reload the latest values and try again.",
      ),
      { status: 409 },
    );
}

function developmentEntityType(action: ConnectionCommand["action"]) {
  if (action === "save-staffing-role") return "Staffing Role" as const;
  if (action === "save-site-staffing-requirement")
    return "Site Staffing Requirement" as const;
  return "Site Role Assignment" as const;
}

function mapOperationalAssignments(
  records: CanonicalRecord[],
  legendLabels: Map<string, string>,
  oplocLabels: Map<string, string>,
) {
  return records
    .filter(
      (record) =>
        record.entityType === "Operational Assignment" &&
        record.lifecycleStatus !== "archived",
    )
    .map((record) => ({
      canonicalId: record.canonicalId,
      legendId: String(record.record.legendId || ""),
      legendLabel:
        legendLabels.get(String(record.record.legendId || "")) ||
        "Archived or unavailable Legend",
      oplocId: String(record.record.oplocId || ""),
      oplocLabel:
        oplocLabels.get(String(record.record.oplocId || "")) ||
        "Archived or unavailable OPLOC",
      assignmentRole: String(record.record.assignmentRole || ""),
      designation: String(record.record.designation || "secondary"),
      effectiveFrom: String(record.record.effectiveFrom || ""),
      effectiveTo: optionalString(record.record.effectiveTo),
      lifecycleState: String(record.record.lifecycleState || "active"),
      version: Number(record.record.version || 0),
    }));
}

function optionalString(value: unknown) {
  const text = String(value || "");
  return text || undefined;
}

function byLabel(left: { label: string }, right: { label: string }) {
  return left.label.localeCompare(right.label);
}
