import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appDataPath } from "../../shared/app-data-path";

type DocumentMap = Record<string, unknown>;
export type TransactionState = { rolling: DocumentMap; publications: DocumentMap };

const databaseFile = () => process.env.MENU_PLANNING_DB_PATH || appDataPath("menu-planning", "menu-planning", process.argv.includes("--test") ? "operational.test.sqlite" : "operational.sqlite");
const rollingJson = appDataPath("menu-planning", "menu-planning", "rolling-menu-weeks.json");
const publicationsJson = appDataPath("menu-planning", "menu-planning", "menu-publications.json");
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
  let database: DatabaseSync | undefined;
  try {
    const file = databaseFile();
    mkdirSync(dirname(file), { recursive: true });
    database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS operational_documents (document_key TEXT PRIMARY KEY, document_json TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const count = Number((database.prepare("SELECT COUNT(*) AS count FROM operational_documents").get() as { count: number }).count);
    if (count === 0) {
      const now = new Date().toISOString();
      const rolling = readSeed(rollingJson, { version: 1, weeks: [], days: [], entries: [] }, "Rolling menu data");
      const publications = readSeed(publicationsJson, { version: 2, publications: [], events: [] }, "Menu publication data");
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

export function readRollingState<T>() { const database = open(); try { return parseDocument(database, "rolling") as T; } finally { database.close(); } }
export function readPublicationState<T>() { const database = open(); try { return parseDocument(database, "publications") as T; } finally { database.close(); } }

export function withMenuPlanningTransaction<T>(mutator: (state: TransactionState) => T) {
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
    try { database.exec("ROLLBACK"); } catch { /* preserve the original persistence error */ }
    throw cause;
  } finally {
    database.close();
  }
}

export function updateRollingState<T>(mutator: (rolling: T) => void) {
  return withMenuPlanningTransaction(state => { mutator(state.rolling as T); return state.rolling as T; });
}

export function updatePublicationState<T>(mutator: (publications: T) => void) {
  return withMenuPlanningTransaction(state => { mutator(state.publications as T); return state.publications as T; });
}
