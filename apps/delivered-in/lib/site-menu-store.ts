import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SiteMenuArtifact } from "./site-menu";
import { appDataPath } from "../../shared/app-data-path";

type StoredSiteMenus = { version: 1; artifacts: SiteMenuArtifact[] };
const file = appDataPath("delivered-in", "delivered-in", "site-menus.json");
const read = (): StoredSiteMenus => { if (!existsSync(file)) return { version: 1, artifacts: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSiteMenus>; if (!Array.isArray(value.artifacts)) throw new Error("artifacts is not an array"); return { version: 1, artifacts: value.artifacts }; } catch (cause) { throw Object.assign(new Error("Delivered-In site-menu artifacts are unavailable; no artifact list was loaded.", { cause }), { status: 503 }); } };
const write = (value: StoredSiteMenus) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };

export function listSiteMenuArtifacts() { return read().artifacts; }
export function latestSiteMenuArtifact(oplocId: string, sourceDayId: string) { return read().artifacts.filter(value => value.oplocId === oplocId && value.sourceDayId === sourceDayId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]; }
export function saveSiteMenuArtifact(artifact: SiteMenuArtifact) { const stored = read(); stored.artifacts.push(artifact); write(stored); return artifact; }
