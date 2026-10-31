import { NextResponse } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { requireCatalogueMutationActor, resolveMenuActor } from "@/lib/auth";
import { createDishTag, readDishTagRegistry } from "@/lib/dish-tag-store";
import { DISH_TAG_GROUPS, DISH_TAG_GROUP_LABELS, groupTags, searchTags } from "@/lib/dish-tags";

const statusOf = (error: unknown) => (error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500);

/** Searchable tag list. `?q=` filters by name or synonym; `?group=` narrows to one group. */
async function handleGet(request: Request) {
  try {
    const url = new URL(request.url);
    const registry = await readDishTagRegistry();
    const tags = searchTags(registry, url.searchParams.get("q") || "", { group: url.searchParams.get("group") || undefined });
    return NextResponse.json({
      version: registry.version,
      total: registry.tags.length,
      tags,
      groups: groupTags(tags),
      groupLabels: DISH_TAG_GROUP_LABELS,
      knownGroups: DISH_TAG_GROUPS,
    });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Tags could not be loaded." } }, { status: statusOf(error) });
  }
}

/** Inline tag creation. An equivalent existing tag is returned (200) instead of a duplicate (201 when created). */
async function handlePost(request: import("next/server").NextRequest) {
  try {
    const body = await request.json() as { action?: string; label?: string; group?: string; synonyms?: string[]; expectedVersion?: number };
    if (body.action !== "create-tag") return NextResponse.json({ error: { message: "Unknown tag command." } }, { status: 400 });
    const actor = requireCatalogueMutationActor(await resolveMenuActor(request));
    if (body.expectedVersion !== undefined && !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: { message: "expectedVersion must be a whole number." } }, { status: 422 });
    const result = await createDishTag({ label: String(body.label ?? ""), group: String(body.group ?? ""), synonyms: body.synonyms }, actor.uid, body.expectedVersion);
    return NextResponse.json({ tag: result.tag, outcome: result.outcome, version: result.registry.version }, { status: result.outcome === "created" ? 201 : 200 });
  } catch (error) {
    const status = statusOf(error);
    console.error("Menu Planning tag mutation failed", error);
    return NextResponse.json({ error: { message: status >= 500 ? "The tag could not be saved. Please try again." : error instanceof Error ? error.message : "The tag could not be saved." } }, { status });
  }
}

export async function GET(request: Request) {
  return withDataTrace({ app: "menu-planning", action: "menu-planning.dish-tags.load", path: new URL(request.url).pathname }, () => handleGet(request));
}

export async function POST(request: import("next/server").NextRequest) {
  return withDataTrace({ app: "menu-planning", action: "menu-planning.dish-tags.mutate", path: new URL(request.url).pathname }, () => handlePost(request));
}
