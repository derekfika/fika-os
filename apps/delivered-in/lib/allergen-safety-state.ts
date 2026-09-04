import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appDataPath } from "../../shared/app-data-path";
import { db } from "./firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";

export type AllergenSafetyState = {
  siteId: string; serviceDate: string; releaseId: string; releaseVersion: string; releaseHash: string;
  previousReleaseId?: string; previousReleaseVersion?: string;
  releaseStatus: "current" | "revoked_pending";
  menuStatus: "current" | "stale" | "withdrawn" | "regenerating";
  regenerationStatus: "not_required" | "pending" | "complete" | "failed";
  reprintRequired: boolean;
  delta?: Array<{ menuItemId: string; dishName: string; allergen: string; previously: string; now: string }>;
  acknowledgement?: { releaseVersion: string; actor: string; acknowledgedAt: string };
  updatedAt: string;
};

const file = appDataPath("delivered-in", "delivered-in", "allergen-safety-state.json");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const key = (siteId: string, serviceDate: string, releaseVersion: string) => stableDocumentId(`${siteId}:${serviceDate}:${releaseVersion}`);
type LocalState = { version: 1; states: AllergenSafetyState[] };
function readLocal(): LocalState { if (!existsSync(file)) return { version: 1, states: [] }; const value = JSON.parse(readFileSync(file, "utf8")) as LocalState; if (!Array.isArray(value.states)) throw new Error("Delivered-In allergen safety state is invalid."); return value; }
function writeLocal(value: LocalState) { mkdirSync(dirname(file), { recursive: true }); const temp = `${file}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2)); renameSync(temp, file); }

export function revokeSafetyState(previous: AllergenSafetyState, updatedAt: string): AllergenSafetyState {
  return { ...previous, releaseStatus: "revoked_pending", menuStatus: "withdrawn", regenerationStatus: "pending", reprintRequired: true, acknowledgement: undefined, updatedAt };
}
export function publishSafetyState(input: { siteId: string; serviceDate: string; releaseId: string; releaseVersion: string; releaseHash: string; previousReleaseId?: string; previousReleaseVersion?: string; delta?: AllergenSafetyState["delta"]; regenerated: boolean; updatedAt: string }): AllergenSafetyState {
  return { siteId: input.siteId, serviceDate: input.serviceDate, releaseId: input.releaseId, releaseVersion: input.releaseVersion, releaseHash: input.releaseHash, ...(input.previousReleaseId ? { previousReleaseId: input.previousReleaseId } : {}), ...(input.previousReleaseVersion ? { previousReleaseVersion: input.previousReleaseVersion } : {}), ...(input.delta?.length ? { delta: input.delta } : {}), releaseStatus: "current", menuStatus: input.regenerated ? "current" : "stale", regenerationStatus: input.regenerated ? "complete" : "pending", reprintRequired: Boolean(input.previousReleaseId), updatedAt: input.updatedAt };
}
export function acknowledgeSafetyState(state: AllergenSafetyState, actor: string, acknowledgedAt: string) {
  if (state.releaseStatus !== "current") throw new Error("A revoked allergen release cannot be acknowledged.");
  return { ...state, acknowledgement: { releaseVersion: state.releaseVersion, actor, acknowledgedAt }, updatedAt: acknowledgedAt };
}

export async function readAllergenSafetyState(siteId: string, serviceDate: string, releaseVersion: string) {
  if (!hosted()) return readLocal().states.find(state => state.siteId === siteId && state.serviceDate === serviceDate && state.releaseVersion === releaseVersion);
  const snapshot = await db.collection("fikaDeliveredInAllergenSafetyV1").doc(key(siteId, serviceDate, releaseVersion)).get();
  return snapshot.exists ? snapshot.data() as AllergenSafetyState : undefined;
}
export async function saveAllergenSafetyState(state: AllergenSafetyState) {
  if (!hosted()) { const stored = readLocal(); stored.states = [...stored.states.filter(value => !(value.siteId === state.siteId && value.serviceDate === state.serviceDate && value.releaseVersion === state.releaseVersion)), state]; writeLocal(stored); return state; }
  await db.collection("fikaDeliveredInAllergenSafetyV1").doc(key(state.siteId, state.serviceDate, state.releaseVersion)).set(state, { merge: true });
  return state;
}
export async function acknowledgeAllergenSafety(siteId: string, serviceDate: string, releaseVersion: string, actor: string, acknowledgedAt: string) {
  const current = await readAllergenSafetyState(siteId, serviceDate, releaseVersion);
  if (!current) throw new Error("The current allergen release safety state is unavailable.");
  return saveAllergenSafetyState(acknowledgeSafetyState(current, actor, acknowledgedAt));
}
