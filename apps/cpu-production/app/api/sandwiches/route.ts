import { NextRequest, NextResponse } from "next/server";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { legacyProductionItemId, productionItemId } from "../../../lib/production-item-id";
import { requireCpuActor } from "../../../lib/cpu-access-client";

const libraryUrl = () => process.env.MENU_PLANNING_URL || "http://localhost:3500";
function repositoryRoot() {
  let candidate = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(candidate, "local-data", "menu-planning"))) return candidate;
    candidate = path.dirname(candidate);
  }
  return path.resolve(process.cwd(), "..", "..");
}
const localLibraryPath = () => path.join(repositoryRoot(), "local-data", "menu-planning", "saved-sandwiches.json");
const seedLibraryPath = () => path.join(process.cwd(), "data", "production-items-seed.json");
const deliveredInSeedLibraryPath = () => path.join(process.cwd(), "data", "delivered-in-lunch-items-seed.json");

type SavedProductionItem = {
  id: string;
  title: string;
  allergens: Record<string, string>;
  mayContainNotes?: string;
  itemType?: "sandwich" | "salad" | "pastry" | "dessert" | "box" | "other";
  sourceEvidence?: string[];
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  parentMenuItemKey?: string;
  category?: "Salad 1" | "Salad 2" | "Salad 3" | "Salad 4" | "Salad 5" | "Salad 6" | "Cold protein" | "Soup" | "Hot meat" | "Hot veg / vegan" | "Extras / sides";
};

function productionItemKey(item: SavedProductionItem) {
  return `${item.parentMenuItemKey || ""}:${item.title.trim().toLocaleLowerCase()}`;
}

function mergeProductionItems(...groups: SavedProductionItem[][]) {
  const byTitleAndScope = new Map<string, SavedProductionItem>();
  for (const group of groups) {
    for (const item of group) byTitleAndScope.set(productionItemKey(item), item);
  }
  return [...byTitleAndScope.values()].sort((a, b) => a.title.localeCompare(b.title));
}

async function localProductionItems() {
  try {
    const saved = JSON.parse(await fs.readFile(localLibraryPath(), "utf8")) as SavedProductionItem[];
    try {
      const seeded = JSON.parse(await fs.readFile(seedLibraryPath(), "utf8")) as SavedProductionItem[];
      const delivered = JSON.parse(await fs.readFile(deliveredInSeedLibraryPath(), "utf8")) as SavedProductionItem[];
      return mergeProductionItems(seeded, delivered, saved);
    } catch {
      return saved;
    }
  } catch {
    try {
      const seeded = JSON.parse(await fs.readFile(seedLibraryPath(), "utf8")) as SavedProductionItem[];
      try {
        const delivered = JSON.parse(await fs.readFile(deliveredInSeedLibraryPath(), "utf8")) as SavedProductionItem[];
        return mergeProductionItems(seeded, delivered);
      } catch {
        return seeded;
      }
    } catch {
      return [];
    }
  }
}

async function localFallback(request: NextRequest, method: "GET" | "POST") {
  const productionItems = await localProductionItems();
  if (method === "GET") {
    const parentMenuItemKey = request.nextUrl.searchParams.get("parentMenuItemKey");
    const items = parentMenuItemKey ? productionItems.filter((item) => item.parentMenuItemKey === parentMenuItemKey) : productionItems;
    return NextResponse.json({ productionItems: items, sandwiches: items });
  }
  const body = await request.json() as { title?: string; allergens?: Record<string, string>; mayContainNotes?: string; updatedBy?: string; itemType?: SavedProductionItem["itemType"]; sourceEvidence?: string[]; parentMenuItemKey?: string; category?: SavedProductionItem["category"] };
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: { message: "A production item title is required." } }, { status: 422 });
  const now = new Date().toISOString();
  const parentMenuItemKey = body.parentMenuItemKey?.trim() || undefined;
  const id = productionItemId(title, parentMenuItemKey);
  const legacyId = legacyProductionItemId(title);
  const previous = productionItems.find((item) => item.id === id) || productionItems.find((item) => item.id === legacyId && (!item.parentMenuItemKey || item.parentMenuItemKey === parentMenuItemKey));
  const productionItem: SavedProductionItem = { id, title, allergens: body.allergens || {}, mayContainNotes: body.mayContainNotes?.trim() || "", itemType: body.itemType || previous?.itemType || "sandwich", category: body.category || previous?.category, sourceEvidence: body.sourceEvidence || previous?.sourceEvidence || [], ...(parentMenuItemKey ? { parentMenuItemKey } : previous?.parentMenuItemKey ? { parentMenuItemKey: previous.parentMenuItemKey } : {}), createdAt: previous?.createdAt || now, updatedAt: now, updatedBy: body.updatedBy || "production-chef" };
  const next = mergeProductionItems(productionItems.filter((item) => item.id !== id && (item.id !== legacyId || (item.parentMenuItemKey && item.parentMenuItemKey !== parentMenuItemKey))), [productionItem]);
  await fs.mkdir(path.dirname(localLibraryPath()), { recursive: true });
  await fs.writeFile(localLibraryPath(), JSON.stringify(next, null, 2), "utf8");
  return NextResponse.json({ productionItem, sandwich: productionItem, productionItems: next, sandwiches: next });
}

async function forward(request: NextRequest, method: "GET" | "POST") {
  await requireCpuActor(request);
  try {
    const response = await fetch(`${libraryUrl()}/api/sandwiches${method === "GET" ? request.nextUrl.search : ""}`, { method, headers: method === "POST" ? { "content-type": "application/json" } : undefined, body: method === "POST" ? await request.clone().text() : undefined, cache: "no-store" });
    const body = await response.text();
    if (!response.ok || body.trimStart().startsWith("<!DOCTYPE")) return localFallback(request, method);
    // Keep a local durable copy as well as the shared menu-planning record.
    // This means the CPU checker retains user-entered allergen evidence even
    // when the remote menu-planning service is later unavailable.
    if (method === "POST") await localFallback(request, "POST");
    // Keep the shared seed candidates visible even when the menu-planning app is running.
    // The remote library remains authoritative for existing IDs; seeds only fill gaps.
    try {
      const remote = JSON.parse(body) as { sandwiches?: SavedProductionItem[]; productionItems?: SavedProductionItem[] };
      const remoteItems = remote.productionItems || remote.sandwiches || [];
      const seeded = await localProductionItems();
      const merged = mergeProductionItems(seeded, remoteItems);
      const parentMenuItemKey = request.nextUrl.searchParams.get("parentMenuItemKey");
      const scoped = parentMenuItemKey ? merged.filter((item) => item.parentMenuItemKey === parentMenuItemKey) : merged;
      // Keep the stable response shape expected by the CPU planner: productionItems, sandwiches: productionItems.
      return NextResponse.json({ ...remote, productionItems: scoped, sandwiches: scoped }, { status: response.status });
    } catch {
      return new NextResponse(body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" } });
    }
  } catch { return localFallback(request, method); }
}
export async function GET(request: NextRequest) { return forward(request, "GET"); }
export async function POST(request: NextRequest) { return forward(request, "POST"); }
