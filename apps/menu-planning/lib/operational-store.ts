import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertOperationalStoreAvailable } from "./hosted-runtime";
import { MenuPlanningFirestoreRepository, type HostedTransactionState, type MenuPlanningTransactionScope } from "./firestore-operational-store";
import { claimEvent, eventIsDue } from "./fika-contracts";

type DocumentMap = Record<string, unknown>;
export type TransactionState = { rolling: DocumentMap; publications: DocumentMap };

const databaseFile = () => process.env.MENU_PLANNING_DB_PATH || join(/*turbopackIgnore: true*/ process.cwd(), "local-data", "menu-planning", process.argv.includes("--test") ? "operational.test.sqlite" : "operational.sqlite");
const rollingJson = join(/*turbopackIgnore: true*/ process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
const publicationsJson = join(/*turbopackIgnore: true*/ process.cwd(), "local-data", "menu-planning", "menu-publications.json");
const unavailable = (message: string, cause?: unknown) => Object.assign(new Error(message, cause ? { cause } : undefined), { status: 503 });

function readSeed(file: string, fallback: DocumentMap, label: string) {
  if (!existsSync(file)) return fallback;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object") throw new Error(`${label} is not an object`);
    return value as DocumentMap;
  } catch (cause) {
    throw unavailable(`${label} is unavailable; no operational data was loaded.`, cause);
  }
}

function open() {
  assertOperationalStoreAvailable();
  let database: DatabaseSync | undefined;
  try {
    const file = databaseFile();
    mkdirSync(dirname(file), { recursive: true });
    database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS operational_documents (document_key TEXT PRIMARY KEY, document_json TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const count = Number((database.prepare("SELECT COUNT(*) AS count FROM operational_documents").get() as { count: number }).count);
    if (count === 0) {
      const now = new Date().toISOString();
      // Tests always opt into a fresh temporary database and must never seed
      // from the mutable local operational files.
      const rolling = process.env.MENU_PLANNING_TEST_MODE === "1" ? { version: 1, weeks: [], days: [], entries: [] } : readSeed(rollingJson, { version: 1, weeks: [], days: [], entries: [] }, "Rolling menu data");
      const publications = process.env.MENU_PLANNING_TEST_MODE === "1" ? { version: 2, publications: [], events: [] } : readSeed(publicationsJson, { version: 2, publications: [], events: [] }, "Menu publication data");
      database.exec("BEGIN IMMEDIATE");
      const insert = database.prepare("INSERT INTO operational_documents (document_key, document_json, updated_at) VALUES (?, ?, ?)");
      try { insert.run("rolling", JSON.stringify(rolling), now); insert.run("publications", JSON.stringify(publications), now); database.exec("COMMIT"); } catch (cause) { try { database.exec("ROLLBACK"); } catch { /* preserve original persistence error */ } throw cause; }
    }
    return database;
  } catch (cause) {
    try { database?.close(); } catch { /* preserve original persistence error */ }
    if (cause && typeof cause === "object" && "status" in cause) throw cause;
    throw unavailable("Menu Planning operational persistence is unavailable.", cause);
  }
}

function parseDocument(database: DatabaseSync, key: "rolling" | "publications") {
  try {
    const row = database.prepare("SELECT document_json FROM operational_documents WHERE document_key = ?").get(key) as { document_json?: string } | undefined;
    if (!row?.document_json) throw new Error(`Missing ${key} operational document`);
    return JSON.parse(row.document_json) as DocumentMap;
  } catch (cause) {
    throw unavailable(`Menu Planning ${key} persistence is unavailable; no data was loaded.`, cause);
  }
}

export type MenuPlanningOperationalStore = {
  readonly kind: "sqlite" | "firestore";
  readRollingState<T>(): Promise<T>;
  listWeekSummaries<T>(): Promise<T[]>;
  getWeekSnapshot<T>(weekId: string): Promise<T | undefined>;
  readPublicationState<T>(): Promise<T>;
  readPublicationStateForWeek<T>(weekId: string): Promise<T>;
  updateEvent(eventId: string, mutator: (event: HostedTransactionState["publications"]["events"][number]) => HostedTransactionState["publications"]["events"][number] | undefined): Promise<HostedTransactionState["publications"]["events"][number] | undefined>;
  claimNextEvent(claimId: string, at?: Date): Promise<HostedTransactionState["publications"]["events"][number] | undefined>;
  runTransaction<T>(mutator: (state: TransactionState) => T | Promise<T>, expected?: { weekId?: string; weekVersion?: number }, scope?: MenuPlanningTransactionScope): Promise<T>;
  updateRollingState<T>(mutator: (rolling: T) => void | Promise<void>): Promise<T>;
  updatePublicationState<T>(mutator: (publications: T) => void | Promise<void>): Promise<T>;
};

function withMenuPlanningTransactionSync<T>(mutator: (state: TransactionState) => T) {
  const database = open();
  database.exec("BEGIN IMMEDIATE");
  try {
    const state: TransactionState = { rolling: parseDocument(database, "rolling"), publications: parseDocument(database, "publications") };
    const result = mutator(state);
    const updatedAt = new Date().toISOString();
    const update = database.prepare("UPDATE operational_documents SET document_json = ?, updated_at = ? WHERE document_key = ?");
    update.run(JSON.stringify(state.rolling), updatedAt, "rolling");
    update.run(JSON.stringify(state.publications), updatedAt, "publications");
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    try { database.exec("ROLLBACK"); } catch { /* preserve original persistence error */ }
    throw cause;
  } finally { database.close(); }
}

class SqliteOperationalStore implements MenuPlanningOperationalStore {
  readonly kind = "sqlite" as const;
  async readRollingState<T>() { const database = open(); try { return parseDocument(database, "rolling") as T; } finally { database.close(); } }
  async listWeekSummaries<T>() { return (await this.readRollingState<{ weeks: T[] }>()).weeks; }
  async getWeekSnapshot<T>(weekId: string) { const state = await this.readRollingState<{ weeks: Array<{ id: string; dayIds: string[]; entryIds: string[] }>; days: unknown[]; entries: unknown[] }>(); const week = state.weeks.find(candidate => candidate.id === weekId); return week ? { week, days: state.days.filter((day: any) => week.dayIds.includes(day.id)), entries: state.entries.filter((entry: any) => week.entryIds.includes(entry.id)) } as T : undefined; }
  async readPublicationState<T>() { const database = open(); try { return parseDocument(database, "publications") as T; } finally { database.close(); } }
  async readPublicationStateForWeek<T>(weekId: string) { const state = await this.readPublicationState<{ version: number; publications: Array<{ sourceWeekId: string }>; events: unknown[] }>(); return { ...state, publications: state.publications.filter(publication => publication.sourceWeekId === weekId), events: [] } as T; }
  async updateEvent(eventId: string, mutator: (event: HostedTransactionState["publications"]["events"][number]) => HostedTransactionState["publications"]["events"][number] | undefined) { return this.runTransaction(state => { const publications = state.publications as unknown as HostedTransactionState["publications"]; const event = publications.events.find(candidate => candidate.eventId === eventId); if (!event) return undefined; const next = mutator(event); if (next) publications.events[publications.events.findIndex(candidate => candidate.eventId === eventId)] = next; return next; }); }
  async claimNextEvent(claimId: string, at = new Date()) { return this.runTransaction(state => { const publications = state.publications as unknown as HostedTransactionState["publications"]; const candidates = publications.events.slice().sort((a, b) => a.sourceAggregateId.localeCompare(b.sourceAggregateId) || a.sourceVersion - b.sourceVersion || a.eventId.localeCompare(b.eventId)); const event = candidates.find(candidate => eventIsDue(candidate, at) && !candidates.some(previous => previous.sourceAggregateId === candidate.sourceAggregateId && previous.sourceVersion < candidate.sourceVersion && previous.delivery.status !== "delivered")); if (!event) return undefined; const next = claimEvent(event, claimId, at.toISOString()); publications.events[publications.events.findIndex(candidate => candidate.eventId === event.eventId)] = next; return next; }); }
  async runTransaction<T>(mutator: (state: TransactionState) => T | Promise<T>) {
    return withMenuPlanningTransactionSync(state => { const result = mutator(state); if (result instanceof Promise) throw new Error("SQLite operational mutators must remain synchronous internally."); return result; });
  }
  async updateRollingState<T>(mutator: (rolling: T) => void | Promise<void>) { return this.runTransaction(state => { const result = mutator(state.rolling as T); if (result instanceof Promise) throw new Error("SQLite operational mutators must remain synchronous internally."); return state.rolling as T; }); }
  async updatePublicationState<T>(mutator: (publications: T) => void | Promise<void>) { return this.runTransaction(state => { const result = mutator(state.publications as T); if (result instanceof Promise) throw new Error("SQLite operational mutators must remain synchronous internally."); return state.publications as T; }); }
}

class FirestoreOperationalStore implements MenuPlanningOperationalStore {
  readonly kind = "firestore" as const;
  constructor(private readonly repository = new MenuPlanningFirestoreRepository()) {}
  readRollingState<T>() { return this.repository.readRollingState() as Promise<T>; }
  listWeekSummaries<T>() { return this.repository.listWeekSummaries() as Promise<T[]>; }
  getWeekSnapshot<T>(weekId: string) { return this.repository.getWeekSnapshot(weekId) as Promise<T | undefined>; }
  readPublicationState<T>() { return this.repository.readPublicationState() as Promise<T>; }
  readPublicationStateForWeek<T>(weekId: string) { return this.repository.readPublicationStateForWeek(weekId) as Promise<T>; }
  updateEvent(eventId: string, mutator: (event: HostedTransactionState["publications"]["events"][number]) => HostedTransactionState["publications"]["events"][number] | undefined) { return this.repository.updateEvent(eventId, mutator); }
  claimNextEvent(claimId: string, at?: Date) { return this.repository.claimNextEvent(claimId, at); }
  runTransaction<T>(mutator: (state: HostedTransactionState) => T | Promise<T>, expected?: { weekId?: string; weekVersion?: number }, scope?: MenuPlanningTransactionScope) { return this.repository.runTransaction(mutator, expected, scope); }
  updateRollingState<T>(mutator: (rolling: T) => void | Promise<void>) { return this.runTransaction(async state => { await mutator(state.rolling as T); return state.rolling as T; }); }
  updatePublicationState<T>(mutator: (publications: T) => void | Promise<void>) { return this.runTransaction(async state => { await mutator(state.publications as T); return state.publications as T; }); }
}

let selectedStore: MenuPlanningOperationalStore | undefined;
export function getMenuPlanningOperationalStore(): MenuPlanningOperationalStore {
  if (selectedStore) return selectedStore;
  const mode = process.env.FIKA_RUNTIME_MODE || "local";
  if (["staging", "production"].includes(mode)) {
    if (!process.env.FIREBASE_PROJECT_ID && !process.env.GCLOUD_PROJECT) throw Object.assign(new Error("Menu Planning Firestore persistence is not configured; hosted mode never falls back to local data."), { status: 503, code: "MENU_OPERATIONAL_STORE_NOT_CONFIGURED" });
    selectedStore = new FirestoreOperationalStore();
  } else selectedStore = new SqliteOperationalStore();
  return selectedStore;
}

export function readRollingState<T>() { return getMenuPlanningOperationalStore().readRollingState<T>(); }
export function listWeekSummaries<T>() { return getMenuPlanningOperationalStore().listWeekSummaries<T>(); }
export function getWeekSnapshot<T>(weekId: string) { return getMenuPlanningOperationalStore().getWeekSnapshot<T>(weekId); }
export function readPublicationState<T>() { return getMenuPlanningOperationalStore().readPublicationState<T>(); }
export function readPublicationStateForWeek<T>(weekId: string) { return getMenuPlanningOperationalStore().readPublicationStateForWeek<T>(weekId); }

export function withMenuPlanningTransaction<T>(mutator: (state: TransactionState) => T | Promise<T>, expected?: { weekId?: string; weekVersion?: number }, scope?: MenuPlanningTransactionScope) { return getMenuPlanningOperationalStore().runTransaction(mutator, expected, scope); }

export function updateRollingState<T>(mutator: (rolling: T) => void | Promise<void>) { return getMenuPlanningOperationalStore().updateRollingState(mutator); }

export function updatePublicationState<T>(mutator: (publications: T) => void | Promise<void>) { return getMenuPlanningOperationalStore().updatePublicationState(mutator); }
export function updateMenuPlanningEvent(eventId: string, mutator: (event: HostedTransactionState["publications"]["events"][number]) => HostedTransactionState["publications"]["events"][number] | undefined) { return getMenuPlanningOperationalStore().updateEvent(eventId, mutator); }
export function claimNextMenuPlanningEvent(claimId: string, at?: Date) { return getMenuPlanningOperationalStore().claimNextEvent(claimId, at); }

// The hosted adapter is async because Firestore transactions are async. It is
// exported from the operational-store boundary so Phase 2B can switch the
// application call sites without exposing Firestore to route/browser code.
export { MenuPlanningFirestoreRepository, MENU_PLANNING_COLLECTIONS, ExpectedVersionConflict, assertExpectedVersion, type HostedTransactionState, type MenuPlanningTransactionScope } from "./firestore-operational-store";
