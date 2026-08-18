import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { parseCanonical } from "./schemas";
import type { CanonicalRecord } from "./types";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");
const mappings = () => db.collection("integrationHubSourceMappings");

export type OperationalAreaCommand = {
  canonicalId?: string;
  expectedVersion?: number;
  oplocId: string;
  name: string;
  areaTypeId: string;
  floorLevel: number;
  description?: string;
  lifecycleState: "active" | "archived";
  localOperationalInstructions?: string;
};

export async function operationalAreasOverview(oplocId: string) {
  const [recordsSnapshot, mappingsSnapshot] = await Promise.all([
    canonical().get(),
    mappings().get(),
  ]);
  const records = recordsSnapshot.docs.map(
    (document) => document.data() as CanonicalRecord,
  );
  const types = records
    .filter(
      (record) =>
        record.entityType === "Operational Area Type" &&
        record.lifecycleStatus !== "archived",
    )
    .map((record) => ({
      canonicalId: record.canonicalId,
      name: String(record.record.name || record.canonicalId),
      active: record.record.lifecycleState === "active",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const typeNames = new Map(types.map((type) => [type.canonicalId, type.name]));
  const areas = records
    .filter(
      (record) =>
        record.entityType === "Operational Area" &&
        record.lifecycleStatus !== "archived" &&
        record.record.oplocId === oplocId,
    )
    .map((record) => ({
      canonicalId: record.canonicalId,
      name: String(record.record.name || record.canonicalId),
      areaTypeId: String(record.record.areaTypeId || ""),
      areaTypeName:
        typeNames.get(String(record.record.areaTypeId || "")) ||
        "Unavailable area type",
      floorLevel: Number(record.record.floorLevel),
      description: optionalText(record.record.description),
      lifecycleState: String(record.record.lifecycleState || "active") as
        | "active"
        | "archived",
      configuration:
        record.record.configuration && typeof record.record.configuration === "object"
          ? record.record.configuration
          : {},
      aliases: Array.isArray(record.record.aliases) ? record.record.aliases : [],
      version: Number(record.record.version || 0),
      providerMappings: mappingsSnapshot.docs
        .map((document) => document.data())
        .filter(
          (mapping) => mapping.targetCanonicalId === record.canonicalId,
        )
        .map((mapping) => ({
          mappingId: String(mapping.mappingId || ""),
          sourceProvider: String(mapping.sourceProvider || ""),
          sourceEntityType: String(mapping.sourceEntityType || ""),
          sourceIdentifier: String(mapping.sourceIdentifier || ""),
          sourceLabel: optionalText(mapping.sourceLabel),
          mappingStatus: String(mapping.mappingStatus || "unresolved"),
        })),
    }))
    .sort(
      (left, right) =>
        left.floorLevel - right.floorLevel || left.name.localeCompare(right.name),
    );
  return { types, areas };
}

export async function saveOperationalArea(
  actor: Actor,
  input: OperationalAreaCommand,
) {
  const snapshot = await canonical().get();
  const records = snapshot.docs.map(
    (document) => document.data() as CanonicalRecord,
  );
  const current = input.canonicalId
    ? records.find((record) => record.canonicalId === input.canonicalId)
    : undefined;
  if (input.canonicalId && (!current || current.entityType !== "Operational Area"))
    throw Object.assign(new Error("Operational Area not found."), { status: 404 });
  if (
    current &&
    Number(current.record.version) !== Number(input.expectedVersion)
  )
    throw Object.assign(
      new Error("This Operational Area changed elsewhere. Refresh and try again."),
      { status: 409 },
    );
  const oploc = records.find(
    (record) =>
      record.entityType === "OPLOC" &&
      record.canonicalId === input.oplocId &&
      record.lifecycleStatus !== "archived" &&
      record.record.lifecycleState === "active",
  );
  if (!oploc)
    throw Object.assign(new Error("Choose an active canonical OPLOC."), {
      status: 409,
    });
  const areaType = records.find(
    (record) =>
      record.entityType === "Operational Area Type" &&
      record.canonicalId === input.areaTypeId &&
      record.record.lifecycleState === "active",
  );
  if (!areaType)
    throw Object.assign(new Error("Choose an active Operational Area Type."), {
      status: 409,
    });
  const duplicate = records.find(
    (record) =>
      record.entityType === "Operational Area" &&
      record.canonicalId !== input.canonicalId &&
      record.lifecycleStatus !== "archived" &&
      record.record.oplocId === input.oplocId &&
      record.record.lifecycleState === "active" &&
      normalise(String(record.record.name || "")) === normalise(input.name),
  );
  if (duplicate)
    throw Object.assign(
      new Error("This OPLOC already has an active Operational Area with that name."),
      { status: 409 },
    );
  const now = new Date().toISOString();
  const canonicalId = input.canonicalId || generateCanonicalId("Operational Area");
  const configuration = input.localOperationalInstructions?.trim()
    ? { localOperationalInstructions: input.localOperationalInstructions.trim() }
    : current?.record.configuration || undefined;
  const record = {
    ...(current ? structuredClone(current.record) : base(canonicalId, actor.uid, now)),
    entityType: "Operational Area" as const,
    canonicalId,
    areaId: canonicalId,
    oplocId: input.oplocId,
    name: input.name.trim(),
    areaTypeId: input.areaTypeId,
    floorLevel: input.floorLevel,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    lifecycleState: input.lifecycleState,
    aliases: Array.isArray(current?.record.aliases)
      ? current!.record.aliases
      : [],
    ...(configuration ? { configuration } : {}),
    version: Number(current?.record.version || 0) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  const parsed = parseCanonical("Operational Area", record);
  if (!parsed.success)
    throw Object.assign(
      new Error(`Operational Area validation failed: ${parsed.error.issues[0]?.message}`),
      { status: 409 },
    );
  const next: CanonicalRecord = {
    canonicalId,
    entityType: "Operational Area",
    record,
    dataHash: sha256(JSON.stringify(record)),
    lifecycleStatus: current?.lifecycleStatus || "needs-review",
    ...(current?.publicationStatus
      ? { publicationStatus: current.publicationStatus }
      : {}),
  };
  const revisionId = `canonical-revision:${stableDocumentId(`${canonicalId}:${record.version}`)}`;
  const auditId = crypto.randomUUID();
  const reason = `${current ? "Updated" : "Created"} the Operational Area '${record.name}' within '${String(oploc.record.approvedName)}'. This does not create a separate OPLOC or staffing entity.`;
  const batch = db.batch();
  batch.set(canonical().doc(stableDocumentId(canonicalId)), next);
  batch.set(revisions().doc(stableDocumentId(revisionId)), {
    revisionId,
    canonicalId,
    entityType: "Operational Area",
    version: record.version,
    previous: current || null,
    current: next,
    changes: [{ path: "operationalArea", before: current?.record || null, after: record }],
    actorId: actor.uid,
    actorName: actor.name,
    reason,
    recordedAt: now,
  });
  batch.set(audit().doc(auditId), {
    auditId,
    action:
      input.lifecycleState === "archived"
        ? "Operational Area archived"
        : current?.record.lifecycleState === "archived"
          ? "Operational Area restored"
          : current
            ? "Operational Area updated"
            : "Operational Area created",
    entityReference: canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: now,
    reason,
    oplocId: input.oplocId,
  });
  await batch.commit();
  return next;
}

function base(canonicalId: string, actorId: string, now: string) {
  return {
    schemaVersion: "0.1.0",
    createdAt: now,
    createdBy: actorId,
    active: true,
    externalIdentities: [],
    provenanceIds: [],
    ownership: { providerOwned: {}, fikaOwned: {} },
    canonicalId,
  };
}

function optionalText(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function normalise(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}
