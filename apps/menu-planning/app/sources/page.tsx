import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourcePackManifest } from "@/lib/source-packs";
import RecipeImportPanel from "./recipe-import-panel";
import MenuPlanningShell from "../menu-planning-shell";

async function loadManifest(): Promise<SourcePackManifest> {
  return JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "source-pack-manifest.json"), "utf8")) as SourcePackManifest;
}

export default async function SourcePacksPage() {
  const manifest = await loadManifest();
  return <MenuPlanningShell section="History & Imports"><section className="workspace-intro"><small>Published history, source evidence and imports</small><h2>History &amp; Imports</h2><p>Keep historical workbooks, source packs and provenance traceable. Nothing imported is approved or published automatically.</p></section><section className="workspace-panel"><header className="panel-header"><div><small>Manifest {manifest.version}</small><h3>Imported source evidence</h3></div><span className="status status--imported">Review required</span></header><div className="import-summary">{manifest.packs.map(pack => <div className="metric-card" key={pack.id}><strong>{pack.files.length}</strong><span>{pack.label}</span></div>)}</div><div className="library-list">{manifest.packs.map(pack => <article className="library-row" key={pack.id}><div><strong>{pack.label}</strong><span>{pack.kind === "regional_recipe_pack" ? "Regional menu and recipe evidence" : "Weekly delivered-in lunch workbooks"}</span><small>{pack.files.filter(file => ["xlsx", "xls"].includes(file.extension)).length} spreadsheets · {pack.files.filter(file => file.extension === "docx").length} documents · retained as source evidence</small></div><span className="status status--unreviewed">Unreviewed</span></article>)}</div><p className="form-help">Nothing is silently mapped or published. Ambiguous rows remain available for deliberate review, canonical item creation and audit.</p></section><RecipeImportPanel /></MenuPlanningShell>;
}
