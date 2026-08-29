import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SiteMenuArtifact } from "./site-menu";
import { appDataPath } from "../../shared/app-data-path";
import { db } from "@fika/server-shared/firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";

type StoredSiteMenus = { version: 1; artifacts: SiteMenuArtifact[] };
const file = appDataPath("delivered-in", "delivered-in", "site-menus.json");
const read = (): StoredSiteMenus => { if (!existsSync(file)) return { version: 1, artifacts: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSiteMenus>; if (!Array.isArray(value.artifacts)) throw new Error("artifacts is not an array"); return { version: 1, artifacts: value.artifacts }; } catch (cause) { throw Object.assign(new Error("Delivered-In site-menu artifacts are unavailable; no artifact list was loaded.", { cause }), { status: 503 }); } };
const write = (value: StoredSiteMenus) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const siteMenus = () => db.collection("fikaDeliveredInSiteMenusV1");

export function listSiteMenuArtifacts() { return read().artifacts; }
export function latestSiteMenuArtifact(oplocId: string, sourceDayId: string) { return read().artifacts.filter(value => value.oplocId === oplocId && value.sourceDayId === sourceDayId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]; }
export function saveSiteMenuArtifact(artifact: SiteMenuArtifact) { const stored = read(); stored.artifacts.push(artifact); write(stored); return artifact; }
export async function latestSiteMenuArtifactHosted(oplocId: string, sourceDayId: string) {
  if (!hosted()) return latestSiteMenuArtifact(oplocId, sourceDayId);
  const snapshot = await siteMenus().doc(stableDocumentId(`${oplocId}:${sourceDayId}`)).get();
  recordDeliveredInAppReadBudget({ stage: "current_site_menu_lookup", recordsInspected: snapshot.exists ? 1 : 0, oplocId });
  return snapshot.exists ? snapshot.data()?.artifact as SiteMenuArtifact : undefined;
}
export async function saveSiteMenuArtifactHosted(artifact: SiteMenuArtifact) {
  if (!hosted()) return saveSiteMenuArtifact(artifact);
  const current = siteMenus().doc(stableDocumentId(`${artifact.oplocId}:${artifact.sourceDayId}`));
  await db.runTransaction(async transaction => {
    transaction.set(current, { artifact, updatedAt: artifact.generatedAt });
    transaction.set(current.collection("revisions").doc(stableDocumentId(artifact.artifactId)), { artifact, recordedAt: artifact.generatedAt });
  });
  recordDeliveredInAppReadBudget({ stage: "site_menu_metadata_write", recordsInspected: 1, oplocId: artifact.oplocId });
  return artifact;
}
