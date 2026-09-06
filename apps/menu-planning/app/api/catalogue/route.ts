import { NextResponse } from "next/server";
import { filterCatalogueEntries, getCatalogueEntryById } from "@/lib/catalogue";
import { createCanonicalMenuItem, mergeSimilarCanonicalItems, previewSimilarCanonicalItems } from "@/lib/canonical-menu-repository";
import { repointDishIds } from "@/lib/rolling-menu";
import { getPublishedCatalogueManifest as getCatalogueManifest } from "@/lib/catalogue-manifest";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { getCatalogueReadPackage } from "@/lib/catalogue-read-package";

async function handleGet(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("duplicates") === "preview") return NextResponse.json({ groups: await previewSimilarCanonicalItems() });
    const url = new URL(request.url);
    if (url.searchParams.get("manifest") === "true") return NextResponse.json(await getCatalogueManifest());
    const id = url.searchParams.get("id");
    if (id) {
      const entry = await getCatalogueEntryById(id);
      return entry ? NextResponse.json({ entry }) : NextResponse.json({ error: { message: "Catalogue item was not found." } }, { status: 404 });
    }
    const { value: snapshot, manifest: packageManifest } = await getCatalogueReadPackage();
    const entries = snapshot.entries;
    const filtered = filterCatalogueEntries(entries, {
      query: url.searchParams.get("q") || undefined,
      category: url.searchParams.get("category") || undefined,
      usage: url.searchParams.get("usage") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    return NextResponse.json({ entries: filtered, total: entries.length, filteredCount: filtered.length, categories: snapshot.categories, manifest: { schemaVersion: packageManifest.schemaVersion, catalogueVersion: packageManifest.packageVersion, updatedAt: packageManifest.generatedAt, dishCount: packageManifest.recordCount, package: packageManifest } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Catalogue could not be loaded." } }, { status });
  }
}

export async function GET(request: Request) { return withDataTrace({ app: "menu-planning", action: new URL(request.url).searchParams.get("manifest") === "true" ? "menu-planning.catalogue.manifest" : "menu-planning.catalogue.load", path: new URL(request.url).pathname }, () => handleGet(request)); }

export async function POST(request: Request) {
  let action = "";
  try {
    const body = await request.json() as { action?: string; displayName?: string; category?: string; description?: string; preparationNotes?: string; canonicalIds?: string[]; sourceReference?: { workbook: string; sheet: string; range?: string; rawValue?: unknown }; sourceEvidence?: { document: string; excerpt?: string; importedAt: string }; allergenEvidence?: Array<{ allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown"; source: string; reviewedBy?: string; reviewedAt?: string; notes?: string }> };
    action = String(body.action || "");
    if (action === "create-dish") {
      if (!body.displayName?.trim()) return NextResponse.json({ error: { message: "A dish name is required." } }, { status: 422 });
      const item = await createCanonicalMenuItem({ ...body, displayName: body.displayName! });
      return NextResponse.json({ item }, { status: 201 });
    }
    if (action !== "merge-similar-dishes" && action !== "merge-reviewed-dishes") return NextResponse.json({ error: { message: "Unknown catalogue command." } }, { status: 400 });
    const result = await mergeSimilarCanonicalItems(action === "merge-reviewed-dishes" ? "reviewed-dish-merge" : "automatic-dish-normaliser", action === "merge-reviewed-dishes" ? new Set(body.canonicalIds || []) : undefined);
    const updatedEntries = await repointDishIds(result.mapping, result.aliases);
    return NextResponse.json({ merged: result.merged, updatedEntries });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    console.error("Menu Planning catalogue mutation failed", error);
    return NextResponse.json({ error: { message: status >= 500 ? action === "create-dish" ? "Dish could not be created. Please try again." : "Catalogue command could not be completed. Please try again." : error instanceof Error ? error.message : "Catalogue command failed." } }, { status });
  }
}
