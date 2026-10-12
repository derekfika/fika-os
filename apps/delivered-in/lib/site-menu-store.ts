import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SiteMenuArtifact } from "./site-menu";
import { appDataPath } from "../../shared/app-data-path";
import { db } from "./firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

type StoredSiteMenus = { version: 1; artifacts: SiteMenuArtifact[] };
const file = appDataPath("delivered-in", "delivered-in", "site-menus.json");
const read = (): StoredSiteMenus => { if (!existsSync(file)) return { version: 1, artifacts: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSiteMenus>; if (!Array.isArray(value.artifacts)) throw new Error("artifacts is not an array"); return { version: 1, artifacts: value.artifacts }; } catch (cause) { throw Object.assign(new Error("Delivered-In site-menu artifacts are unavailable; no artifact list was loaded.", { cause }), { status: 503 }); } };
const write = (value: StoredSiteMenus) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const siteMenus = () => db.collection("fikaDeliveredInSiteMenusV1");

export function listSiteMenuArtifacts() { return read().artifacts; }
export type SiteMenuFormat = NonNullable<SiteMenuArtifact["format"]>;
/** Formats that carry their own current artifact per day. Tablet keeps the original record key. */
export const SITE_MENU_FORMATS: SiteMenuFormat[] = ["tablet", "flat-label", "tent-label"];
const formatOf = (artifact: Pick<SiteMenuArtifact, "format">): SiteMenuFormat => artifact.format || "tablet";
const documentKey = (oplocId: string, sourceDayId: string, format: SiteMenuFormat) => format === "tablet" ? `${oplocId}:${sourceDayId}` : `${oplocId}:${sourceDayId}:${format}`;
export function latestSiteMenuArtifact(oplocId: string, sourceDayId: string, format: SiteMenuFormat = "tablet") { return read().artifacts.filter(value => value.oplocId === oplocId && value.sourceDayId === sourceDayId && formatOf(value) === format).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]; }
export function saveSiteMenuArtifact(artifact: SiteMenuArtifact) { const stored = read(); stored.artifacts.push(artifact); write(stored); return artifact; }
export async function latestSiteMenuArtifactHosted(oplocId: string, sourceDayId: string, format: SiteMenuFormat = "tablet") {
  if (!hosted()) return latestSiteMenuArtifact(oplocId, sourceDayId, format);
  const snapshot = await siteMenus().doc(stableDocumentId(documentKey(oplocId, sourceDayId, format))).get();
  recordDataAccess({ app: "delivered-in", operation: "site-menu.by-oploc-day", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  recordDeliveredInAppReadBudget({ stage: "current_site_menu_lookup", recordsInspected: snapshot.exists ? 1 : 0, oplocId });
  return snapshot.exists ? snapshot.data()?.artifact as SiteMenuArtifact : undefined;
}
export async function saveSiteMenuArtifactHosted(artifact: SiteMenuArtifact) {
  if (!hosted()) return saveSiteMenuArtifact(artifact);
  const current = siteMenus().doc(stableDocumentId(documentKey(artifact.oplocId, artifact.sourceDayId, formatOf(artifact))));
  await db.runTransaction(async transaction => {
    transaction.set(current, { artifact, updatedAt: artifact.generatedAt });
    transaction.set(current.collection("revisions").doc(stableDocumentId(artifact.artifactId)), { artifact, recordedAt: artifact.generatedAt });
  });
  recordDeliveredInAppReadBudget({ stage: "site_menu_metadata_write", recordsInspected: 1, oplocId: artifact.oplocId });
  return artifact;
}

/** Mark every known artifact for a site/date (tablet and any label formats) non-current while retaining the audit revisions. */
export async function revokeSiteMenuArtifactHosted(oplocId: string, sourceDayId: string, releaseId: string, revokedAt = new Date().toISOString()) {
  if (!hosted()) {
    const stored = read();
    let revoked = false;
    for (const format of SITE_MENU_FORMATS) {
      const index = stored.artifacts.findIndex(value => value.oplocId === oplocId && value.sourceDayId === sourceDayId && formatOf(value) === format);
      if (index < 0) continue;
      stored.artifacts[index] = { ...stored.artifacts[index], revokedAt, reprintRequired: true, sourceReleaseId: releaseId };
      revoked = true;
    }
    if (revoked) write(stored);
    return revoked;
  }
  let revoked = false;
  for (const format of SITE_MENU_FORMATS) {
    const current = siteMenus().doc(stableDocumentId(documentKey(oplocId, sourceDayId, format)));
    const snapshot = await current.get();
    recordDataAccess({ app: "delivered-in", operation: "site-menu.revoke.by-oploc-day", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
    const artifact = snapshot.exists ? snapshot.data()?.artifact as SiteMenuArtifact | undefined : undefined;
    if (!artifact) continue;
    const next = { ...artifact, revokedAt, reprintRequired: true, sourceReleaseId: releaseId };
    await db.runTransaction(async transaction => {
      transaction.set(current, { artifact: next, updatedAt: revokedAt });
      transaction.set(current.collection("revisions").doc(stableDocumentId(`${artifact.artifactId}:revoked:${releaseId}`)), { artifact: next, recordedAt: revokedAt });
    });
    revoked = true;
  }
  return revoked;
}
