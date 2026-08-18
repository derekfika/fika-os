import { NextResponse } from "next/server";
import { filterCatalogueEntries, listCatalogueEntries } from "@/lib/catalogue";
import { mergeSimilarCanonicalItems } from "@/lib/canonical-menu-repository";
import { repointDishIds } from "@/lib/rolling-menu";

export async function GET(request: Request) {
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
  const body = await request.json() as { action?: string };
  if (body.action !== "merge-similar-dishes") return NextResponse.json({ error: "Unknown catalogue command." }, { status: 400 });
  const result = await mergeSimilarCanonicalItems();
  const updatedEntries = repointDishIds(result.mapping, result.aliases);
  return NextResponse.json({ merged: result.merged, updatedEntries });
}
