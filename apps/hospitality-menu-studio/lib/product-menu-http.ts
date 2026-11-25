import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { z } from "zod";
import { idSchema } from "../../shared/hospitality-menu-studio-content";
import { productMenuDraft, productMenuSetup } from "../../shared/hospitality-menu-studio-product-content";
import { catalogueUnavailable } from "./catalogue";
import type { StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import type { ProductMenuStore } from "./product-menu-store";

const headers = { "Cache-Control": "private, no-store" };
const maximumBytes = 500_000;
const readQuery = z.union([z.strictObject({ itemId: idSchema }), z.strictObject({ cursor: idSchema.optional() })]);
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), itemId: idSchema, setup: productMenuSetup }),
  z.strictObject({ action: z.literal("save"), item: productMenuDraft }),
]);

export function productMenuHandlers(dependencies: {
  authorise: (request: Request) => Promise<StudioActor>;
  readCatalogue: (request: Request) => Promise<CatalogueLoadResult>;
  assertOrigin: (request: Request) => void;
  store: () => Pick<ProductMenuStore, "read" | "list" | "createOrOpen" | "save">;
}) {
  async function authorisedItems(request: Request) {
    const catalogue = await dependencies.readCatalogue(request);
    if (catalogue.source === "cache-unverified") throw catalogueUnavailable();
    return new Set(catalogue.catalogue.items.map(item => item.id));
  }

  async function response(action: () => Promise<unknown>) {
    try {
      return Response.json(await action(), { headers });
    } catch (error) {
      const failure = error instanceof StudioProblem ? error : error instanceof z.ZodError
        ? new StudioProblem(422, "INVALID_REQUEST", error.issues[0]?.message ?? "Check the details and try again.")
        : new StudioProblem(503, "STUDIO_UNAVAILABLE", "Studio storage or authority is unavailable.");
      return Response.json({ code: failure.code, error: failure.message }, { status: failure.status, headers });
    }
  }

  return {
    GET: (request: Request) => response(async () => {
      await dependencies.authorise(request);
      const params = new URL(request.url).searchParams;
      const query = readQuery.parse(Object.fromEntries(params));
      if ([...params].length > 1) throw new StudioProblem(422, "INVALID_REQUEST", "Choose a single product or page.");
      const items = await authorisedItems(request);
      if ("itemId" in query) {
        requireCurrentItem(items, query.itemId);
        return { item: await dependencies.store().read(query.itemId) };
      }
      return dependencies.store().list(items, query.cursor);
    }),
    POST: (request: Request) => response(async () => {
      dependencies.assertOrigin(request);
      const actor = await dependencies.authorise(request);
      if (!actor.canManage) throw new StudioProblem(403, "STUDIO_WRITE_DENIED", "Studio authoring is read-only for this account.");
      const input = command.parse(await readJson(request));
      const itemId = input.action === "create" ? input.itemId : input.item.itemId;
      requireCurrentItem(await authorisedItems(request), itemId);
      const store = dependencies.store();
      const item = input.action === "create" ? await store.createOrOpen(actor.id, itemId, input.setup) : await store.save(actor.id, input.item);
      return { item };
    }),
  };
}

function requireCurrentItem(items: ReadonlySet<string>, itemId: string) {
  if (!items.has(itemId)) {
    throw new StudioProblem(404, "PRODUCT_MENU_ITEM_UNAVAILABLE", "Choose a product from the current Hospitality catalogue.");
  }
}

async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new StudioProblem(415, "INVALID_CONTENT_TYPE", "Studio requires a JSON request.");
  }
  const tooLarge = () => new StudioProblem(413, "DRAFT_TOO_LARGE", "This draft exceeds the storage limit.");
  if (Number(request.headers.get("content-length")) > maximumBytes) throw tooLarge();
  if (!request.body) throw new StudioProblem(422, "INVALID_REQUEST", "The request could not be read.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maximumBytes) throw tooLarge();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
  } catch (error) {
    if (error instanceof StudioProblem) throw error;
    throw new StudioProblem(422, "INVALID_REQUEST", "The request could not be read.");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
