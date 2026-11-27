import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";

/** A menu placement keeps its established slot identity while exposing a custom label. */
export type MenuStructureRow = { id: string; slot: string; name: string };
export type MenuStructureCategory = { id: string; name: string; rows: MenuStructureRow[] };
export type MenuStructureSnapshot = {
  templateId?: string;
  templateVersion?: number;
  categories: MenuStructureCategory[];
};
export type MenuStructureTemplate = MenuStructureSnapshot & {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
  audit: Array<{ action: "created" | "edited" | "duplicated" | "archived"; at: string; by: string }>;
};

const validIdentity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const canonicalSlots = new Set<string>(CANONICAL_MENU_SLOTS.map(slot => slot.id));

/** Validate layout metadata without changing the established production slot contract. */
export function validateMenuStructure(value: unknown): MenuStructureSnapshot {
  if (!value || typeof value !== "object") throw Object.assign(new Error("Choose a menu structure."), { status: 422 });
  const candidate = value as { templateId?: unknown; templateVersion?: unknown; categories?: unknown };
  if (!Array.isArray(candidate.categories) || candidate.categories.length < 1 || candidate.categories.length > 20) {
    throw Object.assign(new Error("A menu structure needs 1–20 categories."), { status: 422 });
  }
  const categoryIds = new Set<string>();
  const rowIds = new Set<string>();
  const slots = new Set<string>();
  const categories = candidate.categories.map((rawCategory: unknown) => {
    if (!rawCategory || typeof rawCategory !== "object") throw Object.assign(new Error("Each category needs a name and rows."), { status: 422 });
    const category = rawCategory as { id?: unknown; name?: unknown; rows?: unknown };
    const id = String(category.id || "");
    const name = typeof category.name === "string" ? category.name.trim() : "";
    if (!validIdentity(id) || categoryIds.has(id) || !name || name.length > 60 || !Array.isArray(category.rows) || category.rows.length < 1 || category.rows.length > CANONICAL_MENU_SLOTS.length) {
      throw Object.assign(new Error("Categories need unique IDs, names and at least one row."), { status: 422 });
    }
    categoryIds.add(id);
    const rows = category.rows.map((rawRow: unknown) => {
      if (!rawRow || typeof rawRow !== "object") throw Object.assign(new Error("Each row needs a name and placement."), { status: 422 });
      const row = rawRow as { id?: unknown; slot?: unknown; name?: unknown };
      const rowId = String(row.id || "");
      const slot = typeof row.slot === "string" ? row.slot : "";
      const rowName = typeof row.name === "string" ? row.name.trim() : "";
      if (!validIdentity(rowId) || rowIds.has(rowId) || !canonicalSlots.has(slot) || slots.has(slot) || !rowName || rowName.length > 60) {
        throw Object.assign(new Error("Rows need a unique placement and a name up to 60 characters."), { status: 422 });
      }
      rowIds.add(rowId);
      slots.add(slot);
      return { id: rowId, slot, name: rowName };
    });
    return { id, name, rows };
  });
  const templateId = typeof candidate.templateId === "string" && validIdentity(candidate.templateId) ? candidate.templateId : undefined;
  const templateVersion = Number.isInteger(candidate.templateVersion) && Number(candidate.templateVersion) > 0 ? Number(candidate.templateVersion) : undefined;
  return { ...(templateId ? { templateId } : {}), ...(templateVersion ? { templateVersion } : {}), categories };
}

export function menuStructureSlots(structure: MenuStructureSnapshot) {
  return structure.categories.flatMap(category => category.rows.map(row => row.slot));
}

export function copyMenuStructure(structure: MenuStructureSnapshot, template?: Pick<MenuStructureTemplate, "id" | "version">): MenuStructureSnapshot {
  return {
    ...(template ? { templateId: template.id, templateVersion: template.version } : structure.templateId ? { templateId: structure.templateId } : {}),
    ...(template ? { templateVersion: template.version } : structure.templateVersion ? { templateVersion: structure.templateVersion } : {}),
    categories: structure.categories.map(category => ({ ...category, rows: category.rows.map(row => ({ ...row })) })),
  };
}

export function createBlankMenuStructure(): MenuStructureSnapshot {
  return {
    categories: [{
      id: crypto.randomUUID(),
      name: "Breakfast",
      rows: [{ id: crypto.randomUUID(), slot: CANONICAL_MENU_SLOTS[0].id, name: "New row" }],
    }],
  };
}
