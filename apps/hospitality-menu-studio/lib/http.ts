import { z } from "zod";
import type { Menu, StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { draftCustomerChoices, draftReadiness, menuDishIds } from "./review";
import { commandSchema, dateSchema, idSchema } from "./schema";
import type { StudioStore } from "./store";

const noStore = { "Cache-Control": "private, no-store" };
const maxBytes = 700_000;

const readSchema = z.union([
  z.object({ list: z.enum(["menus", "dishes"]), cursor: idSchema.optional() }).strict(),
  z.object({ list: z.literal("history"), menuId: idSchema, cursor: idSchema.optional() }).strict(),
  z.object({ menuId: idSchema, eventDate: dateSchema }).strict(),
  z.object({ menuId: idSchema, publicationId: idSchema, kitchenDishId: idSchema }).strict(),
  z.object({ menuId: idSchema }).strict(),
  z.object({ dishId: idSchema }).strict(),
]);

export function studioHandlers(
  authorise: (request: Request) => Promise<StudioActor>,
  store: () => StudioStore,
  assertOrigin: (request: Request) => void,
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
      const db = store();
      if ("list" in query) {
        if (query.list === "history") return db.listHistory(query.menuId, query.cursor);
        return db.list(query.list, query.cursor);
      }
      if ("dishId" in query) return { item: await db.read("dishes", query.dishId) };
      if ("kitchenDishId" in query) throw blocked("Current signed kitchen specifications are unavailable.");
      const menu = await db.read<Menu>("menus", query.menuId);
      if ("eventDate" in query) {
        const dishes = await db.dishes(menuDishIds(menu, query.eventDate));
        return { items: draftCustomerChoices(menu, dishes, query.eventDate) };
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

      if (command.action === "review") {
        const db = store();
        const menu = await db.read<Menu>("menus", command.menuId);
        if (menu.version !== command.version) {
          throw new StudioProblem(409, "DRAFT_CONFLICT", "The draft changed. Review the latest saved version.");
        }
        return draftReadiness(menu, await db.dishes(menuDishIds(menu)), command.effectiveDate, command.scope);
      }
      if (command.action === "publish" || command.action === "activate-collection") {
        if (!actor.canPublish) throw denied("You do not have Studio publication access.");
        throw blocked("Signed dish evidence, catalogue eligibility and booking impact must be verified before proceeding.");
      }
      if (!actor.canManage) throw denied("Studio authoring is read-only for this environment or account.");
      if (command.action === "restore-menu") throw blocked("Published revision restoration is unavailable.");
      if (command.action === "save-menu") return { item: await store().save("menus", actor.id, command.item) };
      return { item: await store().save("dishes", actor.id, command.item) };
    }),
  };
}

function blocked(message: string) { return new StudioProblem(503, "PUBLICATION_UNAVAILABLE", message); }
function denied(message: string) { return new StudioProblem(403, "STUDIO_WRITE_DENIED", message); }
function tooLarge() { return new StudioProblem(413, "DRAFT_TOO_LARGE", "This draft exceeds the storage limit."); }
