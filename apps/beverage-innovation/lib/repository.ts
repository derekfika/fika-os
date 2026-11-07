import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { beverageAuditEventSchema, beverageRecordSchema, monthlySpecialSchema, type BeverageAuditEvent, type BeverageRecord, type MonthlySpecialRecord } from "./contracts";
import { beverageDb } from "./firestore-admin";
import type { BeverageActor } from "./runtime";

const BEVERAGES = "beverageRecordsV2";
const SPECIALS = "beverageMonthlySpecialsV1";
const AUDIT = "beverageAuditEventsV1";
const MAX_LIST = 100;

function failure(message: string, status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

function schemaFailure(entityType: string, cause: unknown): never {
  throw failure(`Stored ${entityType} data failed schema validation; serving it as current is blocked.`, 503, "BEVERAGE_DATA_INTEGRITY_FAILED");
}

function receiptId(actorId: string, idempotencyKey: string) {
  return createHash("sha256").update(`${actorId}\0${idempotencyKey}`).digest("hex");
}

export function entityIdForCommand(prefix: "beverage" | "special", actorId: string, idempotencyKey: string) {
  return `${prefix}:${receiptId(actorId, idempotencyKey).slice(0, 40)}`;
}

async function readValidated<T>(db: Firestore, collection: string, id: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
  const snapshot = await db.collection(collection).doc(id).get();
  if (!snapshot.exists) return undefined;
  try {
    const parsed = schema.parse(snapshot.data());
    if ((parsed as { id?: string }).id !== id) return schemaFailure(collection, new Error("Document ID does not match its body."));
    return parsed;
  } catch (error) { return schemaFailure(collection, error); }
}

export async function getBeverage(id: string): Promise<BeverageRecord | undefined> {
  return readValidated(beverageDb(), BEVERAGES, id, beverageRecordSchema);
}

export async function listBeverages(limit = 100): Promise<BeverageRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST) throw failure(`Beverage list limit must be between 1 and ${MAX_LIST}.`, 400, "BEVERAGE_LIST_LIMIT_INVALID");
  const snapshot = await beverageDb().collection(BEVERAGES).orderBy("updatedAt", "desc").limit(limit).get();
  return snapshot.docs.map(document => {
    try { const record = beverageRecordSchema.parse(document.data()); if (record.id !== document.id) return schemaFailure(BEVERAGES, new Error("Document ID mismatch.")); return record; } catch (error) { return schemaFailure(BEVERAGES, error); }
  });
}

export async function findBeveragesByName(name: string, limit = 5): Promise<BeverageRecord[]> {
  const normalizedName = name.trim().toLocaleLowerCase("en-GB");
  if (!normalizedName) return [];
  const snapshot = await beverageDb().collection(BEVERAGES).where("normalizedName", "==", normalizedName).limit(Math.min(Math.max(1, limit), 10)).get();
  return snapshot.docs.map(document => {
    try { return beverageRecordSchema.parse(document.data()); } catch (error) { return schemaFailure(BEVERAGES, error); }
  });
}

export async function listMonthlySpecials(limit = 100): Promise<MonthlySpecialRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST) throw failure(`Specials list limit must be between 1 and ${MAX_LIST}.`, 400, "BEVERAGE_LIST_LIMIT_INVALID");
  const snapshot = await beverageDb().collection(SPECIALS).orderBy("updatedAt", "desc").limit(limit).get();
  return snapshot.docs.map(document => {
    try { const record = monthlySpecialSchema.parse(document.data()); if (record.id !== document.id) return schemaFailure(SPECIALS, new Error("Document ID mismatch.")); return record; } catch (error) { return schemaFailure(SPECIALS, error); }
  });
}

export async function listBeverageAudit(entityId: string, limit = 50): Promise<BeverageAuditEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw failure("Audit history limit must be between 1 and 100.", 400, "BEVERAGE_AUDIT_LIMIT_INVALID");
  const snapshot = await beverageDb().collection(AUDIT).where("entityId", "==", entityId).orderBy("occurredAt", "desc").limit(limit).get();
  return snapshot.docs.map(document => {
    try { const event = beverageAuditEventSchema.parse(document.data()); if (event.eventId !== document.id) return schemaFailure(AUDIT, new Error("Event ID mismatch.")); return event; } catch (error) { return schemaFailure(AUDIT, error); }
  });
}

type VersionedEntity = { id: string; aggregateVersion: number; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string };
export async function commitBeverageCommand<T extends VersionedEntity>(input: {
  entityType: "beverage" | "monthly_special";
  collection: string;
  entityId: string;
  action: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: BeverageActor;
  summary: Record<string, string | number | boolean | null>;
  schema: { parse(value: unknown): T };
  create?: boolean;
  mutate(current: T | undefined, at: string): T | Promise<T>;
}): Promise<T> {
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(input.idempotencyKey)) throw failure("Supply a valid Idempotency-Key for this command.", 400, "BEVERAGE_IDEMPOTENCY_KEY_REQUIRED");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw failure("Supply the expected aggregate version.", 400, "BEVERAGE_EXPECTED_VERSION_REQUIRED");
  const db = beverageDb();
  const commandEventId = receiptId(input.actor.authmodIdentityId, input.idempotencyKey);
  const eventRef = db.collection(AUDIT).doc(commandEventId);
  const entityRef = db.collection(input.collection).doc(input.entityId);

  return db.runTransaction(async transaction => {
    const [eventSnapshot, entitySnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(entityRef)]);
    if (eventSnapshot.exists) {
      const event = beverageAuditEventSchema.parse(eventSnapshot.data());
      if (event.entityId !== input.entityId || event.entityType !== input.entityType || event.action !== input.action || event.actorId !== input.actor.authmodIdentityId) throw failure("Idempotency key was already used for a different Beverage command.", 409, "BEVERAGE_IDEMPOTENCY_KEY_REUSED");
      if (!entitySnapshot.exists) throw failure("A committed Beverage command is missing its authoritative record.", 503, "BEVERAGE_COMMAND_ENTITY_MISSING");
      try { return input.schema.parse(entitySnapshot.data()); } catch (error) { return schemaFailure(input.entityType, error); }
    }

    const current = entitySnapshot.exists ? (() => {
      try { return input.schema.parse(entitySnapshot.data()); } catch (error) { return schemaFailure(input.entityType, error); }
    })() : undefined;
    if (!current && !input.create) throw failure("Beverage record was not found.", 404, "BEVERAGE_NOT_FOUND");
    const versionBefore = current?.aggregateVersion ?? 0;
    if (versionBefore !== input.expectedVersion) throw failure("This Beverage record changed since it was loaded. Refresh and review the latest version.", 409, "BEVERAGE_VERSION_CONFLICT");
    const at = new Date().toISOString();
    const changed = await input.mutate(current, at);
    const after = input.schema.parse({
      ...changed,
      aggregateVersion: versionBefore + 1,
      createdAt: current?.createdAt || at,
      updatedAt: at,
      createdBy: current?.createdBy || input.actor.authmodIdentityId,
      updatedBy: input.actor.authmodIdentityId,
    });
    const event: BeverageAuditEvent = beverageAuditEventSchema.parse({
      eventId: commandEventId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      versionBefore,
      versionAfter: after.aggregateVersion,
      actorId: input.actor.authmodIdentityId,
      sourceApp: "beverage-innovation",
      occurredAt: at,
      idempotencyKey: input.idempotencyKey,
      summary: input.summary,
    });
    transaction.set(entityRef, after);
    transaction.create(eventRef, event);
    return after;
  });
}

export const beverageCollections = { beverages: BEVERAGES, specials: SPECIALS, audit: AUDIT } as const;
