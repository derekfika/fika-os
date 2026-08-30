import { NextResponse } from "next/server";
import { filterCatalogueEntries, getCatalogueEntryById, listCatalogueEntries } from "@/lib/catalogue";
import { createCanonicalMenuItem, mergeSimilarCanonicalItems, previewSimilarCanonicalItems } from "@/lib/canonical-menu-repository";
import { repointDishIds } from "@/lib/rolling-menu";
import { getCatalogueManifest } from "@/lib/catalogue-manifest";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

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
    const [entries, manifest] = await Promise.all([listCatalogueEntries(), getCatalogueManifest()]);
    const filtered = filterCatalogueEntries(entries, {
      query: url.searchParams.get("q") || undefined,
      category: url.searchParams.get("category") || undefined,
      usage: url.searchParams.get("usage") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    return NextResponse.json({ entries: filtered, total: entries.length, filteredCount: filtered.length, categories: [...new Set(entries.map((entry) => entry.category))].sort(), manifest });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Catalogue could not be loaded." } }, { status });
  }
}

export async function GET(request: Request) { return withDataTrace({ app: "menu-planning", action: new URL(request.url).searchParams.get("manifest") === "true" ? "menu-planning.catalogue.manifest" : "menu-planning.catalogue.load", path: new URL(request.url).pathname }, () => handleGet(request)); }

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; displayName?: string; category?: string; description?: string; preparationNotes?: string; canonicalIds?: string[]; allergenEvidence?: Array<{ allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown"; source: string; reviewedBy?: string; reviewedAt?: string; notes?: string }> };
  if (body.action === "create-dish") {
    if (!body.displayName?.trim()) return NextResponse.json({ error: "A dish name is required." }, { status: 422 });
    const item = await createCanonicalMenuItem({ ...body, displayName: body.displayName! });
    return NextResponse.json({ item }, { status: 201 });
  }
  if (body.action !== "merge-similar-dishes" && body.action !== "merge-reviewed-dishes") return NextResponse.json({ error: "Unknown catalogue command." }, { status: 400 });
  const result = await mergeSimilarCanonicalItems(body.action === "merge-reviewed-dishes" ? "reviewed-dish-merge" : "automatic-dish-normaliser", body.action === "merge-reviewed-dishes" ? new Set(body.canonicalIds || []) : undefined);
  const updatedEntries = repointDishIds(result.mapping, result.aliases);
  return NextResponse.json({ merged: result.merged, updatedEntries });
}
