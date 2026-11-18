import { z } from "zod";

const id = z.string().min(1);
const positive = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const indexSchema = z.object({
  items: z.array(z.object({ id, name: z.string(), version: positive })),
  nextCursor: id.nullable(),
});
const component = z.object({ id, name: z.string(), quantity: positive });
const previewSchema = z.object({
  kind: z.literal("published-content-preview"),
  publication: z.object({ id, menuId: id, revision: positive, effectiveDate: z.string() }),
  safety: z.object({ subject: z.object({ dishId: id, revision: positive, sourceHash: hash }), releaseId: id, matrixHash: hash }),
  dish: z.object({ id, name: z.string(), version: positive, kitchenDescription: z.string(), assortment: z.object({ expectedTotal: positive, unit: z.string().min(1), components: z.array(component).min(1) }).nullable() }),
  quantities: z.object({ boxes: positive, unit: z.string().min(1), perBox: positive, total: count, components: z.array(z.object({ id, name: z.string(), perBox: positive, total: positive })) }).optional(),
});
export type PublishedDish = z.infer<typeof indexSchema>["items"][number];
export type KitchenPreview = z.infer<typeof previewSchema>;

export function publishedDishPage(value: unknown) {
  const result = indexSchema.safeParse(value);
  if (!result.success || result.data.items.length > 50 || new Set(result.data.items.map(item => item.id)).size !== result.data.items.length || (result.data.nextCursor !== null && result.data.nextCursor !== result.data.items.at(-1)?.id)) return null;
  return result.data;
}
export function boxCount(value: string): number | null {
  if (!/^\d{1,16}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
export function publishedKitchenPreview(value: unknown, menuId: string, publicationId: string, selected: PublishedDish, requestedBoxes: number | undefined): KitchenPreview | null {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  const { dish, publication, safety, quantities } = result;
  if (publication.id !== publicationId || publication.menuId !== menuId || dish.id !== selected.id || dish.name !== selected.name || dish.version !== selected.version || safety.subject.dishId !== dish.id || safety.subject.revision !== dish.version) return null;
  if (!dish.assortment) return quantities || requestedBoxes !== undefined ? null : result;
  if (new Set(dish.assortment.components.map(row => row.id)).size !== dish.assortment.components.length || dish.assortment.components.reduce((sum, row) => sum + row.quantity, 0) !== dish.assortment.expectedTotal) return null;
  if (!quantities || quantities.boxes !== (requestedBoxes ?? 1) || quantities.unit !== dish.assortment.unit || quantities.perBox !== dish.assortment.expectedTotal || quantities.total !== quantities.perBox * quantities.boxes || !Number.isSafeInteger(quantities.total) || quantities.components.length !== dish.assortment.components.length) return null;
  if (dish.assortment.components.some((row, index) => {
    const actual = quantities.components[index];
    return !actual || actual.id !== row.id || actual.name !== row.name || actual.perBox !== row.quantity || actual.total !== row.quantity * quantities.boxes || !Number.isSafeInteger(actual.total);
  })) return null;
  return result;
}

/** An obsolete request may not repopulate a changed or closed preview. */
export class KitchenRequestGuard {
  private generation = 0;
  next() { return ++this.generation; }
  invalidate() { this.generation++; }
  isCurrent(token: number) { return this.generation === token; }
}
