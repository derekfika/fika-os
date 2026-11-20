import { z } from "zod";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { catalogueUnavailable, siteOfferings, studioCatalogueOptions } from "./catalogue";
import { londonDate, type Dish, type Menu, type StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { draftCustomerChoices, draftReadiness, menuDishIds } from "./review";
import { commandSchema, dateSchema, idSchema, versionQuerySchema, type StudioCommand } from "./schema";
import type { StudioStore } from "./store";
import { compareMenuDrafts } from "./versions";

const noStore = { "Cache-Control": "private, no-store" };
const maxBytes = 700_000;

const readSchema = z.union([
  z.object({ list: z.enum(["menus", "dishes"]), cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("history"), menuId: idSchema, cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("versions"), menuId: idSchema, cursor: versionQuerySchema.optional() }).strict(),
  z.object({ list: z.literal("versions"), dishId: idSchema, cursor: versionQuerySchema.optional() }).strict(),
  z.object({ list: z.literal("catalogue") }).strict(),
  z.object({ menuId: idSchema, fromVersion: versionQuerySchema, toVersion: versionQuerySchema }).strict(),
  z.object({ menuId: idSchema, eventDate: dateSchema, siteId: idSchema.optional() }).strict(),
  z.object({ menuId: idSchema, publicationId: idSchema, kitchenDishId: idSchema }).strict(),
  z.object({ menuId: idSchema }).strict(),
  z.object({ dishId: idSchema, reviewVersion: versionQuerySchema }).strict(),
  z.object({ dishId: idSchema }).strict(),
]);

export function studioHandlers(
  authorise: (request: Request) => Promise<StudioActor>,
  store: () => StudioStore,
  assertOrigin: (request: Request) => void,
  readCatalogue?: (request: Request) => Promise<CatalogueLoadResult>,
  assertCommand?: (command: StudioCommand) => void,
  safetyAvailable: () => boolean = () => false,
) {
  const respond = async (operation: () => Promise<unknown>) => {
    try {
      return Response.json(await operation(), { headers: noStore });
    } catch (error) {
      const problem = error instanceof StudioProblem ? error : error instanceof z.ZodError
        ? new StudioProblem(422, "INVALID_REQUEST", "Check the details and try again.")
        : new StudioProblem(503, "STUDIO_UNAVAILABLE", "Studio storage or authority is unavailable.");
      return Response.json({ code: problem.code, error: problem.message }, { status: problem.status, headers: noStore });
    }
  };

  return {
    GET: (request: Request) => respond(async () => {
      await authorise(request);
      const query = readSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      const catalogue = () => {
        if (!readCatalogue) throw catalogueUnavailable();
        return readCatalogue(request);
      };
      if ("list" in query && query.list === "catalogue") return studioCatalogueOptions((await catalogue()).catalogue);
      if ("reviewVersion" in query && !safetyAvailable()) return { status: "unavailable" };
      const db = store();
      if ("list" in query) {
        if (query.list === "history") return db.listHistory(query.menuId, query.cursor);
        if (query.list === "versions") return "menuId" in query
          ? db.listVersions("menus", query.menuId, query.cursor)
          : db.listVersions("dishes", query.dishId, query.cursor);
        return db.list(query.list, query.cursor);
      }
      if ("fromVersion" in query) {
        const [before, after] = await Promise.all([
          db.readMenuRevision(query.menuId, query.fromVersion),
          db.readMenuRevision(query.menuId, query.toVersion),
        ]);
        return { changes: compareMenuDrafts(before, after) };
      }
      if ("dishId" in query) {
        const dish = await db.read<Dish>("dishes", query.dishId);
        if (!("reviewVersion" in query)) return { item: dish };
        if (dish.version !== query.reviewVersion) throw new StudioProblem(409, "DRAFT_CONFLICT", "The dish changed. Reload its latest saved revision.");
        return (await db.dishSafety([dish])).get(dish.id);
      }
      if ("kitchenDishId" in query) throw blocked("Current signed kitchen specifications are unavailable.");
      const menu = await db.read<Menu>("menus", query.menuId);
      if ("eventDate" in query) {
        if (!query.siteId) {
          const dishes = await db.dishes(menuDishIds(menu, query.eventDate));
          return { items: draftCustomerChoices(menu, dishes, query.eventDate) };
        }
        const checked = await catalogue();
        const offerings = siteOfferings(menu, checked.catalogue, query.siteId, query.eventDate);
        const bySection = new Map(offerings.map(offering => [offering.sectionId, offering]));
        const visible = { ...menu, sections: menu.sections.filter(section => bySection.has(section.id)) };
        const dishes = await db.dishes(menuDishIds(visible, query.eventDate));
        const items = draftCustomerChoices(visible, dishes, query.eventDate).map(section => ({
          ...section, catalogueOffering: bySection.get(section.id),
        }));
        return {
          items,
          catalogue: { siteId: query.siteId, contentHash: checked.contentHash, scope: "parent-offerings" },
        };
      }
      return { item: menu };
    }),
    POST: (request: Request) => respond(async () => {
      assertOrigin(request);
      const actor = await authorise(request);
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        throw new StudioProblem(415, "INVALID_CONTENT_TYPE", "Studio requires a JSON request.");
      }
      if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
      const body = await request.text();
      if (Buffer.byteLength(body) > maxBytes) throw tooLarge();
      let data: unknown;
      try { data = JSON.parse(body); }
      catch { throw new StudioProblem(422, "INVALID_REQUEST", "The request could not be read."); }
      const command = commandSchema.parse(data);
      assertCommand?.(command);

      if (command.action === "review") {
        const db = store();
        const menu = await db.read<Menu>("menus", command.menuId);
        if (menu.version !== command.version) {
          throw new StudioProblem(409, "DRAFT_CONFLICT", "The draft changed. Review the latest saved version.");
        }
        const ids = menuDishIds(menu);
        const dishes = await db.dishes(ids);
        if (!safetyAvailable()) return draftReadiness(menu, dishes, command.effectiveDate, command.scope);
        const evidence = await db.dishSafety(dishes);
        const states = ids.map(id => evidence.get(id)?.status);
        const status = states.includes("unavailable") ? "unavailable" : states.length && states.every(state => state === "verified") ? "verified" : "unverified";
        return draftReadiness(menu, dishes, command.effectiveDate, command.scope, londonDate(), { status });
      }
      if (command.action === "publish" || command.action === "activate-collection") {
        if (!actor.canPublish) throw denied("You do not have Studio publication access.");
        throw blocked("Signed dish evidence, catalogue eligibility and booking impact must be verified before proceeding.");
      }
      if (!actor.canManage) throw denied("Studio authoring is read-only for this environment or account.");
      if (command.action === "submit-dish-review") {
        if (!safetyAvailable()) throw blocked("The CPU allergen checker connection is unavailable.");
        const subject = await store().requestDishReview(command.dishId, command.version, actor.id);
        return { subject };
      }
      if (command.action === "restore-menu") throw blocked("Published revision restoration is unavailable.");
      if (command.action === "restore-draft") {
        return store().restoreMenuDraft(actor.id, command.menuId, command.version, command.sourceVersion);
      }
      if (command.action === "save-menu") return { item: await store().save("menus", actor.id, command.item) };
      return { item: await store().save("dishes", actor.id, command.item) };
    }),
  };
}

function blocked(message: string) { return new StudioProblem(503, "PUBLICATION_UNAVAILABLE", message); }
function denied(message: string) { return new StudioProblem(403, "STUDIO_WRITE_DENIED", message); }
function tooLarge() { return new StudioProblem(413, "DRAFT_TOO_LARGE", "This draft exceeds the storage limit."); }
