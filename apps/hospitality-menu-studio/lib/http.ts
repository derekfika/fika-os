import { z } from "zod";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { studioDishReviewSubject } from "../../shared/hospitality-menu-studio-safety";
import { catalogueUnavailable, siteOfferings, studioCatalogueOptions } from "./catalogue";
import type { Dish, Menu, Review, StudioActor } from "./contract";
import type { cpuDishReview } from "./cpu-dish-review";
import { StudioProblem } from "./problem";
import type { PublicationImpactTarget, PublicationRequest } from "./publication";
import { draftCustomerChoices, draftReadiness, menuDishIds } from "./review";
import { commandSchema, dateSchema, idSchema, versionQuerySchema, type StudioCommand } from "./schema";
import type { StudioStore } from "./store";
import { compareMenuDrafts } from "./versions";

const noStore = { "Cache-Control": "private, no-store" };
const maxBytes = 700_000;

const readSchema = z.union([
  z.object({ list: z.enum(["menus", "dishes"]), cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("history"), menuId: idSchema, cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("published-kitchen-dishes"), menuId: idSchema, publicationId: idSchema, cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("versions"), menuId: idSchema, cursor: versionQuerySchema.optional() }).strict(),
  z.object({ list: z.literal("versions"), dishId: idSchema, cursor: versionQuerySchema.optional() }).strict(),
  z.object({ list: z.literal("catalogue") }).strict(),
  z.object({ menuId: idSchema, fromVersion: versionQuerySchema, toVersion: versionQuerySchema }).strict(),
  z.object({ menuId: idSchema, eventDate: dateSchema, siteId: idSchema.optional() }).strict(),
  z.object({ menuId: idSchema, publicationId: idSchema, kitchenDishId: idSchema,
    boxes: z.string().regex(/^\d{1,16}$/).transform(Number).pipe(z.number().int().positive()).optional(),
  }).strict(),
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
  readImpact?: (request: Request, target: PublicationImpactTarget) => Promise<Review["impact"]>,
  stagedReview?: () => ReturnType<typeof cpuDishReview> | undefined,
) {
  const publicationInputs = async (request: Request, actor: StudioActor, command: PublicationRequest, db: StudioStore) => {
    const catalogue = readCatalogue?.(request).catch(() => undefined);
    let impact: Review["impact"] = { status: "unavailable" };
    let impactTarget: PublicationImpactTarget | undefined;
    if (readImpact) {
      impactTarget = await db.publicationImpactTarget(command);
      if (impactTarget.catalogueItemIds.length && impactTarget.firstEventDate <= impactTarget.lastEventDate) {
        impact = await readImpact(request, impactTarget).catch(() => ({ status: "unavailable" }));
      }
    }
    return { actor, catalogue: await catalogue, impact, impactTarget };
  };
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
      const stageChecker = "reviewVersion" in query ? stagedReview?.() : undefined;
      if ("reviewVersion" in query && !stageChecker && !safetyAvailable()) return { status: "unavailable" };
      if (("kitchenDishId" in query || ("list" in query && query.list === "published-kitchen-dishes")) && !safetyAvailable()) {
        throw blocked("Published kitchen specifications are unavailable.");
      }
      const db = store();
      if ("list" in query) {
        if (query.list === "history") return db.listHistory(query.menuId, query.cursor);
        if (query.list === "published-kitchen-dishes") {
          return db.listPublishedKitchenDishes(query.menuId, query.publicationId, query.cursor);
        }
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
        if (stageChecker) return stageChecker.status(studioDishReviewSubject(dish));
        return (await db.dishSafety([dish])).get(dish.id);
      }
      if ("kitchenDishId" in query) {
        return db.previewPublishedKitchen(query.menuId, query.publicationId, query.kitchenDishId, query.boxes);
      }
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
        if (safetyAvailable()) return db.reviewPublication(command, await publicationInputs(request, actor, command, db));
        const menu = await db.read<Menu>("menus", command.menuId);
        if (menu.version !== command.version) {
          throw new StudioProblem(409, "DRAFT_CONFLICT", "The draft changed. Review the latest saved version.");
        }
        return draftReadiness(menu, await db.dishes(menuDishIds(menu)), command.effectiveDate, command.scope);
      }
      if (command.action === "publish") {
        if (!actor.canPublish) throw denied("You do not have Studio publication access.");
        if (!safetyAvailable()) throw blocked("Publication is unavailable in this environment.");
        const db = store();
        const existing = await db.publishedReceipt(command, actor.id);
        return { publication: existing ?? await db.publishReviewed(command, await publicationInputs(request, actor, command, db)) };
      }
      if (command.action === "activate-collection") {
        if (!actor.canPublish) throw denied("You do not have Studio publication access.");
        throw blocked("Signed dish evidence, catalogue eligibility and booking impact must be verified before proceeding.");
      }
      if (!actor.canManage) throw denied("Studio authoring is read-only for this environment or account.");
      if (command.action === "submit-dish-review") {
        const stageChecker = stagedReview?.();
        if (stageChecker) return stageChecker.submit(await store().prepareDishReview(command.dishId, command.version, actor.id));
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
