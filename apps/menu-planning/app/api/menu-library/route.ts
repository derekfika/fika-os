import { NextRequest, NextResponse } from "next/server";
import { listCanonicalMenuItemsByIds } from "@/lib/canonical-menu-repository";
import { requireOrganisationMutationActor, resolveMenuActor } from "@/lib/auth";
import { getMenuPlanningOperationalStore } from "@/lib/operational-store";
import { mutateSavedDailyMenus, validateSavedDailyMenuContent, type SavedDailyMenuContent } from "@/lib/menu-library";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400;
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu Library action failed." } }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await resolveMenuActor(request);
    const menus = await getMenuPlanningOperationalStore().getSavedDailyMenus();
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    return NextResponse.json({ menus: includeArchived ? menus : menus.filter(menu => !menu.archivedAt) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

async function canonicalContent(value: unknown): Promise<SavedDailyMenuContent> {
  const content = validateSavedDailyMenuContent(value);
  const canonicalDishes = await listCanonicalMenuItemsByIds(content.dishes.map(dish => dish.dishId));
  const byId = new Map(canonicalDishes.map(dish => [dish.canonicalId, dish]));
  const dishes = content.dishes.map(dish => {
    const canonicalDish = byId.get(dish.dishId);
    if (!canonicalDish || canonicalDish.reviewStatus === "archived" || canonicalDish.recipeStatus === "archived") {
      throw Object.assign(new Error("A selected dish is no longer available in the canonical Dish Library. Refresh the picker and review the menu."), { status: 409 });
    }
    return { ...dish, dishName: canonicalDish.displayName };
  });
  return { ...content, dishes };
}

export async function POST(request: NextRequest) {
  try {
    const actor = requireOrganisationMutationActor(await resolveMenuActor(request));
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "create" || action === "edit") body.menu = await canonicalContent(body.menu);
    const menus = await getMenuPlanningOperationalStore().updateSavedDailyMenus(current =>
      mutateSavedDailyMenus(current, body, actor.uid, new Date().toISOString()),
    );
    return NextResponse.json({ menus }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
