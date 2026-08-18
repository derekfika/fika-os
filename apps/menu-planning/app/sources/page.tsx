import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourcePackManifest } from "@/lib/source-packs";
import RecipeImportPanel from "./recipe-import-panel";

async function loadManifest(): Promise<SourcePackManifest> {
  return JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "source-pack-manifest.json"), "utf8")) as SourcePackManifest;
}

export default async function SourcePacksPage() {
  const manifest = await loadManifest();
  return <main className="menu-app"><header className="os-header"><a className="os-brand" href="/" aria-label="Back to Menu Planning"><strong>FIKA</strong><span>OS</span></a><div><small>Governed operations</small><h1>Menu Planning</h1></div></header><nav className="menu-nav"><a href="/">Menu hub</a><a className="active" href="/sources">Source packs</a><a href="/dishes/new">Create dish</a></nav><section className="menu-page-heading"><div><small>Imported evidence · never published automatically</small><h2>Source packs.</h2><p>Supplied regional menus, recipes and weekly workbooks stay traceable while the team reviews what becomes canonical.</p></div></section><section className="workspace-panel"><header className="panel-header"><div><small>Manifest {manifest.version}</small><h3>Imported source evidence</h3></div><span className="status status--imported">Review required</span></header><div className="import-summary">{manifest.packs.map(pack => <div className="metric-card" key={pack.id}><strong>{pack.files.length}</strong><span>{pack.label}</span></div>)}</div><div className="library-list">{manifest.packs.map(pack => <article className="library-row" key={pack.id}><div><strong>{pack.label}</strong><span>{pack.kind === "regional_recipe_pack" ? "Regional menu and recipe evidence" : "Weekly delivered-in lunch workbooks"}</span><small>{pack.files.filter(file => ["xlsx", "xls"].includes(file.extension)).length} spreadsheets · {pack.files.filter(file => file.extension === "docx").length} documents · retained as source evidence</small></div><span className="status status--unreviewed">Unreviewed</span></article>)}</div><p className="form-help">Nothing is silently mapped or published. Ambiguous rows remain available for deliberate review, canonical item creation and audit.</p></section><RecipeImportPanel /></main>;
}
