"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserFoodDataLoader } from "@/lib/food-data/client";
import type { FoodDataLoader, FoodDataSession, DatasetResult } from "@/lib/food-data/loader";
import { datasetVersion } from "@/lib/food-data/manifest";
import { buildIngredientRecords } from "@/lib/food-data/ingredients";
import { buildRecipeIndex, buildRecipeRecords } from "@/lib/food-data/recipes";
import styles from "./food-data.module.css";
import ProductLibrary, { useIngredientIndex } from "./ProductLibrary";
import RecipeLibrary from "./RecipeLibrary";
import { integer, snapshotLabel } from "./shared";

type View = "products" | "recipes";
type Phase = { kind: "loading" } | { kind: "ready"; session: FoodDataSession; loader: FoodDataLoader; persistent: boolean } | { kind: "error"; code: string; message: string };
const sourceText = { downloaded: "Downloaded this visit", cache: "Loaded from this browser’s saved copy", "cache-stale": "Saved copy (newer version unavailable)" } as const;

export default function FoodDataWorkspace() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<View>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "recipes" ? "recipes" : "products");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { loader, persistent: canPersist } = await createBrowserFoodDataLoader();
        const session = await loader.load();
        if (!cancelled) setPhase({ kind: "ready", session, loader, persistent: canPersist });
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        if (!cancelled) setPhase({ kind: "error", code: failure.code || "FOOD_DATA_UNAVAILABLE", message: failure.message || "Food Data is unavailable." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function choose(next: View) { setView(next); try { const url = new URL(window.location.href); url.searchParams.set("view", next); window.history.replaceState(null, "", url); } catch { /* History is optional. */ } }

  return <div className={styles.page}>
    <header className={styles.header}><div className={`${styles.inner} ${styles.headerRow}`}>
      <div><h1 className={styles.title}>Food Data</h1><p className={styles.sub}>Product, supplier and recipe libraries imported from Kafoodle</p></div>
      <Link className={styles.back} href="/">← FIKA OS home</Link>
    </div></header>
    <main className={styles.inner}>
      {phase.kind === "loading" && <div className={styles.state} role="status"><h2>Loading Food Data…</h2><p>Checking your access and the saved copy in this browser. The first visit downloads about 1.6&nbsp;MB.</p></div>}
      {phase.kind === "error" && <ErrorState code={phase.code} message={phase.message} />}
      {phase.kind === "ready" && <Ready session={phase.session} view={view} choose={choose} persistent={phase.persistent} loader={phase.loader} />}
    </main>
  </div>;
}

function ErrorState({ code, message }: { code: string; message: string }) {
  const body = code === "FOOD_DATA_UNAUTHENTICATED" ? <p>Sign in to FIKA OS, then return to this page. <a className={styles.link} href={`/?returnTo=${encodeURIComponent("/food-data")}`}>Sign in</a></p>
    : code === "FOOD_DATA_FORBIDDEN" ? <p>Food Data is available to FIKA OS staff accounts. This account can’t use it (for example a shared site account, or one needing administrator review). Nothing has been loaded or kept in this browser.</p>
    : code === "FOOD_DATA_DISABLED" ? <p>Food Data is not enabled in this environment.</p>
    : <p>{message} Nothing is shown until access can be confirmed. <button type="button" className={styles.button} onClick={() => window.location.reload()}>Try again</button></p>;
  return <div className={styles.state} role="alert"><h2>{code === "FOOD_DATA_FORBIDDEN" ? "Food Data isn’t available to this account" : code === "FOOD_DATA_UNAUTHENTICATED" ? "Sign in required" : code === "FOOD_DATA_DISABLED" ? "Food Data is switched off" : "Food Data is unavailable"}</h2>{body}</div>;
}

function Ready({ session, view, choose, persistent, loader }: { session: FoodDataSession; view: View; choose: (view: View) => void; persistent: boolean; loader?: FoodDataLoader }) {
  const { manifest, results } = session;
  const ingredientBundle = results.ingredients.ok ? results.ingredients.bundle : undefined;
  const recipeBundle = results.recipes.ok ? results.recipes.bundle : undefined;
  const ingredientBuild = useMemo(() => { if (!ingredientBundle) return undefined; try { return { records: buildIngredientRecords(ingredientBundle) }; } catch (error) { return { error: (error as Error).message }; } }, [ingredientBundle]);
  const recipeBuild = useMemo(() => { if (!recipeBundle) return undefined; try { return { index: buildRecipeIndex(buildRecipeRecords(recipeBundle), recipeBundle.columns) }; } catch (error) { return { error: (error as Error).message }; } }, [recipeBundle]);
  const ingredientIndex = useIngredientIndex(ingredientBuild && "records" in ingredientBuild && ingredientBuild.records ? ingredientBuild.records : EMPTY);
  const metrics = loader?.metrics;

  return <>
    <dl className={styles.summary} aria-label="About this data">
      <div className={styles.fact}><dt>Source</dt><dd>Kafoodle export <span className={`${styles.badge} ${styles.badgeInfo}`}>Read-only</span></dd></div>
      <div className={styles.fact}><dt>Snapshot date</dt><dd>{snapshotLabel(manifest.snapshot)}</dd></div>
      <div className={styles.fact}><dt>Price refresh</dt><dd>Quarterly (next import not scheduled)</dd></div>
      <div className={styles.fact}><dt>Price-effective date</dt><dd>{manifest.pricing.priceEffectiveDate ? snapshotLabel(manifest.pricing.priceEffectiveDate) : "Unknown — not in the source"}</dd></div>
      <div className={styles.fact}><dt>Product &amp; supplier records</dt><dd>{integer.format(manifest.files.ingredients.rows)} · import {shortVersion(datasetVersion(manifest, "ingredients"))}</dd></div>
      <div className={styles.fact}><dt>Recipe rows</dt><dd>{integer.format(manifest.files.recipes.rows)} · import {shortVersion(datasetVersion(manifest, "recipes"))}</dd></div>
    </dl>
    <div className={styles.note} role="note">Prices include VAT as exported and are a quarterly baseline, not live supplier prices. Calculated ex-VAT and unit costs are marked as calculated. Nothing on this page changes any FIKA OS workflow, menu, order or dish.</div>
    <p className={styles.sub} aria-label="Data source">
      {(["ingredients", "recipes"] as const).map(name => describe(name, results[name])).join(" · ")}
      {metrics ? ` · ${metrics.manifestRequests} manifest check${metrics.manifestRequests === 1 ? "" : "s"}, ${metrics.bundleDownloads.ingredients + metrics.bundleDownloads.recipes} bundle download${metrics.bundleDownloads.ingredients + metrics.bundleDownloads.recipes === 1 ? "" : "s"} this visit` : ""}
    </p>
    {!persistent && <div className={`${styles.note} ${styles.noteWarn}`} role="status">This browser can’t keep a saved copy (storage unavailable), so Food Data downloads again on each visit.</div>}
    {(["ingredients", "recipes"] as const).map(name => { const result = results[name]; return result.ok && result.warning ? <div key={name} className={`${styles.note} ${styles.noteWarn}`} role="status">{result.warning}</div> : null; })}

    <div className={styles.tabs} role="tablist" aria-label="Food Data libraries">
      <button role="tab" id="tab-products" aria-selected={view === "products"} aria-controls="panel-products" tabIndex={view === "products" ? 0 : -1} className={styles.tab} onClick={() => choose("products")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { choose("recipes"); document.getElementById("tab-recipes")?.focus(); } }}>Product &amp; Supplier Library</button>
      <button role="tab" id="tab-recipes" aria-selected={view === "recipes"} aria-controls="panel-recipes" tabIndex={view === "recipes" ? 0 : -1} className={styles.tab} onClick={() => choose("recipes")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { choose("products"); document.getElementById("tab-products")?.focus(); } }}>Recipe Library</button>
    </div>
    <div role="tabpanel" id="panel-products" aria-labelledby="tab-products" hidden={view !== "products"}>
      {!results.ingredients.ok ? <Failure result={results.ingredients} /> : ingredientBuild && "error" in ingredientBuild ? <Failure result={{ ok: false, dataset: "ingredients", error: ingredientBuild.error!, code: "FOOD_DATA_SCHEMA_INVALID" }} /> : <ProductLibrary index={ingredientIndex} manifest={manifest} />}
    </div>
    <div role="tabpanel" id="panel-recipes" aria-labelledby="tab-recipes" hidden={view !== "recipes"}>
      {!results.recipes.ok ? <Failure result={results.recipes} /> : recipeBuild && "error" in recipeBuild ? <Failure result={{ ok: false, dataset: "recipes", error: recipeBuild.error!, code: "FOOD_DATA_SCHEMA_INVALID" }} /> : recipeBuild?.index ? <RecipeLibrary index={recipeBuild.index} manifest={manifest} /> : null}
    </div>
  </>;
}
const EMPTY: never[] = [];
const shortVersion = (version: string) => version.slice(0, 18);
function describe(name: "ingredients" | "recipes", result: DatasetResult) { const label = name === "ingredients" ? "Products" : "Recipes"; return result.ok ? `${label}: ${sourceText[result.source]}` : `${label}: not loaded`; }
function Failure({ result }: { result: Extract<DatasetResult, { ok: false }> }) {
  return <div className={styles.state} role="alert"><h2>{result.dataset === "ingredients" ? "Products" : "Recipes"} could not be loaded</h2><p>{result.error}</p>{result.code === "FOOD_DATA_INTEGRITY_FAILED" && <p>The data failed its integrity check and was discarded rather than shown.</p>}<button type="button" className={styles.button} onClick={() => window.location.reload()}>Try again</button></div>;
}
