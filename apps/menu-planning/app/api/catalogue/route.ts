import { NextResponse } from "next/server";
import { filterCatalogueEntries, listCatalogueEntries } from "@/lib/catalogue";

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
