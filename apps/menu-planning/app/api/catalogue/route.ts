import { NextResponse } from "next/server";
import { filterCatalogueEntries, listCatalogueEntries } from "@/lib/catalogue";
import { createCanonicalMenuItem, mergeSimilarCanonicalItems, previewSimilarCanonicalItems } from "@/lib/canonical-menu-repository";
import { repointDishIds } from "@/lib/rolling-menu";

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("duplicates") === "preview") return NextResponse.json({ groups: await previewSimilarCanonicalItems() });
  const url = new URL(request.url);
  const entries = await listCatalogueEntries();
  const filtered = filterCatalogueEntries(entries, {
    query: url.searchParams.get("q") || undefined,
    category: url.searchParams.get("category") || undefined,
    usage: url.searchParams.get("usage") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  return NextResponse.json({ entries: filtered, total: entries.length, filteredCount: filtered.length, categories: [...new Set(entries.map((entry) => entry.category))].sort() });
}

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
