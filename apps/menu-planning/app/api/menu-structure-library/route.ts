import { NextRequest, NextResponse } from "next/server";
import { requireOrganisationMutationActor, resolveMenuActor } from "@/lib/auth";
import { getMenuPlanningOperationalStore } from "@/lib/operational-store";
import { copyMenuStructure, validateMenuStructure, type MenuStructureTemplate } from "@/lib/menu-structure-library";

export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) => {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400;
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu Library action failed." } }, { status });
};

export async function GET(request: NextRequest) {
  try {
    await resolveMenuActor(request);
    const templates = await getMenuPlanningOperationalStore().getMenuStructureTemplates();
    return NextResponse.json({ templates: request.nextUrl.searchParams.get("includeArchived") === "1" ? templates : templates.filter(template => !template.archivedAt) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

function ensureUniqueName(templates: MenuStructureTemplate[], name: string, exceptId?: string) {
  if (!name || name.length > 100) throw Object.assign(new Error("Enter a menu structure name up to 100 characters."), { status: 422 });
  if (templates.some(template => template.id !== exceptId && !template.archivedAt && template.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw Object.assign(new Error("A saved structure already uses this name."), { status: 409 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = requireOrganisationMutationActor(await resolveMenuActor(request));
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const at = new Date().toISOString();
    const templates = await getMenuPlanningOperationalStore().updateMenuStructureTemplates(current => {
      if (action === "create") {
        const name = String(body.name || "").trim();
        ensureUniqueName(current, name);
        const structure = validateMenuStructure(body.structure);
        const template: MenuStructureTemplate = { categories: structure.categories, id: crypto.randomUUID(), name, version: 1, createdAt: at, createdBy: actor.uid, updatedAt: at, updatedBy: actor.uid, audit: [{ action: "created", at, by: actor.uid }] };
        current.push(template);
        return current;
      }
      const templateId = String(body.templateId || "");
      const index = current.findIndex(template => template.id === templateId);
      if (index < 0) throw Object.assign(new Error("The saved menu structure was not found."), { status: 404 });
      const previous = current[index];
      if (Number(body.expectedVersion) !== previous.version) throw Object.assign(new Error("This saved structure changed. Reload it before saving."), { status: 409 });
      if (previous.archivedAt) throw Object.assign(new Error("Archived structures cannot be changed."), { status: 409 });
      if (action === "edit") {
        const name = String(body.name || "").trim();
        ensureUniqueName(current, name, templateId);
        const structure = validateMenuStructure(body.structure);
        current[index] = { ...previous, categories: structure.categories, name, version: previous.version + 1, updatedAt: at, updatedBy: actor.uid, audit: [...previous.audit, { action: "edited", at, by: actor.uid }] };
      } else if (action === "rename") {
        const name = String(body.name || "").trim();
        ensureUniqueName(current, name, templateId);
        current[index] = { ...previous, name, version: previous.version + 1, updatedAt: at, updatedBy: actor.uid, audit: [...previous.audit, { action: "edited", at, by: actor.uid }] };
      } else if (action === "duplicate") {
        const name = String(body.name || "").trim();
        ensureUniqueName(current, name);
        const structure = copyMenuStructure(previous);
        const duplicate: MenuStructureTemplate = { categories: structure.categories.map(category => ({ ...category, id: crypto.randomUUID(), rows: category.rows.map(row => ({ ...row, id: crypto.randomUUID() })) })), id: crypto.randomUUID(), name, version: 1, createdAt: at, createdBy: actor.uid, updatedAt: at, updatedBy: actor.uid, audit: [{ action: "duplicated", at, by: actor.uid }] };
        current.push(duplicate);
      } else if (action === "archive") {
        current[index] = { ...previous, archivedAt: at, version: previous.version + 1, updatedAt: at, updatedBy: actor.uid, audit: [...previous.audit, { action: "archived", at, by: actor.uid }] };
      } else throw Object.assign(new Error("Choose a supported Menu Library action."), { status: 422 });
      return current;
    });
    return NextResponse.json({ templates }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
