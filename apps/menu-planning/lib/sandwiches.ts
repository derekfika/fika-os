import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { sandwichAllergenColumns, type SavedSandwich, type SandwichAllergens } from "./sandwich-types";
export { sandwichAllergenColumns, type SavedSandwich, type SandwichAllergens } from "./sandwich-types";

function repositoryRoot() {
  let candidate = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(path.join(candidate, "local-data", "menu-planning"))) return candidate;
    candidate = path.dirname(candidate);
  }
  return path.resolve(process.cwd(), "..", "..");
}
const filePath = path.join(repositoryRoot(), "local-data", "menu-planning", "saved-sandwiches.json");
let loaded = false;
const records = new Map<string, SavedSandwich>();

function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled"; }
function normaliseAllergens(input: SandwichAllergens): SandwichAllergens {
  const next = Object.fromEntries(sandwichAllergenColumns.map(([key]) => [key, input[key] || "clear"])) as SandwichAllergens;
  if (next.noKeyAllergens !== "clear") {
    for (const key of Object.keys(next)) if (key !== "noKeyAllergens") next[key] = "clear";
  } else if (Object.entries(next).some(([key, value]) => key !== "noKeyAllergens" && value !== "clear")) next.noKeyAllergens = "clear";
  return next;
}
export async function loadSavedSandwiches() {
  if (loaded) return records;
  loaded = true;
  try { const saved = JSON.parse(await fs.readFile(filePath, "utf8")) as SavedSandwich[]; for (const record of saved) records.set(record.id, record); } catch { /* first local run */ }
  return records;
}
export async function listSavedSandwiches() { await loadSavedSandwiches(); return [...records.values()].sort((a, b) => a.title.localeCompare(b.title)); }
export async function saveSandwich(
  title: string,
  allergens: SandwichAllergens,
  updatedBy = "production-chef",
  mayContainNotes = "",
  parentMenuItemKey = "deli-style-sandwich-lunch",
) {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw Object.assign(new Error("A sandwich title is required."), { status: 422 });
  await loadSavedSandwiches();
  const now = new Date().toISOString();
  const id = `sandwich:${slug(cleanTitle)}`;
  const previous = records.get(id);
  const record: SavedSandwich = { id, title: cleanTitle, allergens: normaliseAllergens(allergens), mayContainNotes: mayContainNotes.trim(), ...(parentMenuItemKey ? { parentMenuItemKey } : {}), createdAt: previous?.createdAt || now, updatedAt: now, updatedBy };
  records.set(id, record);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify([...records.values()], null, 2), "utf8");
  return record;
}
