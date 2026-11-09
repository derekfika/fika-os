import { createHash } from "node:crypto";
import { z } from "zod";
import { HOSPITALITY_DISH_CLASS_IDS, hospitalityDishIdForItem } from "../../shared/hospitality-rotations";
import { createHospitalityDish } from "./canonical-menu-repository";
import { readRotationAccess, rotationsHubFetch } from "./hospitality-rotations-hub";
import { normaliseDishName } from "./text";

export const HospitalityDishRequest = z.object({
  requestId: z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/),
  itemId: z.string().min(1).max(140).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  classification: z.enum(HOSPITALITY_DISH_CLASS_IDS),
  displayName: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
}).strict();

type Deps = { fetchHub: typeof rotationsHubFetch; createDish: typeof createHospitalityDish };
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

/**
 * Create a rotation dish, optionally linking it as a catalogue Item's designated dish.
 * Authorised by the Hub's Rotations Manage permission, not by Menu Planning roles; the write is confined to
 * HOSPITALITY_ROTATIONS records. The dish ID derives from the Item, so a retry can never create a duplicate.
 */
export async function createAndLinkHospitalityDish(cookie: string | null, raw: unknown, deps: Deps = { fetchHub: rotationsHubFetch, createDish: createHospitalityDish }) {
  const input = HospitalityDishRequest.parse(raw);
  const access = await readRotationAccess(cookie, deps.fetchHub);
  if (!access.permissions.Manage || !access.principal) throw failure("Manage access to Hospitality Rotations is required.", 403);
  const actor = `rotations:${access.principal.id}`;

  if (!input.itemId) {
    const identity = createHash("sha256").update(JSON.stringify([actor, input.requestId])).digest("hex");
    const dishId = `hospitality-dish:recipe:${identity}`;
    const { item, outcome } = await deps.createDish({ dishId, displayName: input.displayName, classification: input.classification, description: input.description }, actor);
    if (outcome === "matched_existing" && (item.displayName !== normaliseDishName(input.displayName) || item.hospitalityClass !== input.classification || (item.description || "") !== (input.description || ""))) {
      throw failure("This creation request already belongs to a different dish. Refresh the planner before retrying.", 409);
    }
    return { status: outcome === "created_new" ? 201 : 200, dishId: item.canonicalId, outcome };
  }

  const resourcesResponse = await deps.fetchHub("/api/hospitality-rotations?mode=resources", cookie, { headers: { accept: "application/json" } });
  const resources = await resourcesResponse.json().catch(() => ({})) as { items?: Array<{ id: string; dishId?: string }>; error?: { message?: string } };
  if (!resourcesResponse.ok || !resources.items) throw failure(resources.error?.message || "Hospitality catalogue options are unavailable.", resourcesResponse.status || 503);
  const item = resources.items.find(value => value.id === input.itemId);
  if (!item) throw failure("That catalogue item is not an active Hospitality catalogue item.", 422);
  if (item.dishId) return { status: 200, dishId: item.dishId, outcome: "already_linked" as const };

  const dishId = hospitalityDishIdForItem(input.itemId);
  const { item: dish, outcome } = await deps.createDish({ dishId, displayName: input.displayName, classification: input.classification, description: input.description }, actor);
  const linkResponse = await deps.fetchHub("/api/hospitality-rotations", cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "link-dish", requestId: input.requestId, itemId: input.itemId, dishId: dish.canonicalId, classification: input.classification }) });
  const link = await linkResponse.json().catch(() => ({})) as { error?: { message?: string } };
  if (!linkResponse.ok) throw failure(link.error?.message || "The dish was created but the mapping could not be saved. Retry to complete it.", linkResponse.status || 503);
  return { status: outcome === "created_new" ? 201 : 200, dishId: dish.canonicalId, outcome };
}
