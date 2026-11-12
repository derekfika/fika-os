import { z } from "zod";
import { assertSameOrigin } from "../csrf";
import type { readHospitalityMirrorOutboxInventory } from "./outbox-inventory";
import { safeOutboxInventoryDiagnostic } from "./outbox-inventory-errors";

const cursorSchema = z.object({
  documentId: z.string().min(1).max(200).regex(/^[^/]+$/),
  asOf: z.string().datetime({ offset: true }),
}).strict();
const inputSchema = z.object({ after: cursorSchema.optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();

type Inventory = Awaited<ReturnType<typeof readHospitalityMirrorOutboxInventory>>;
export type OutboxInventoryHttpDeps = {
  authorize(request: Request): Promise<{ principal: { id: string } }>;
  inspect(input: { after?: { documentId: string; asOf: string }; limit: number }): Promise<Inventory>;
};

/** Same-origin AUTHMOD-admin endpoint adapter; it has no delivery or mutation dependency. */
export async function handleHospitalityOutboxInventoryPost(request: Request, deps: OutboxInventoryHttpDeps): Promise<Response> {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid bounded outbox inventory request." }, { status: 400 });
  let actorId: string;
  try {
    assertSameOrigin(request);
    const context = await deps.authorize(request);
    actorId = context.principal.id;
  } catch {
    return Response.json({ error: "An authenticated AUTHMOD administrator is required." }, { status: 403 });
  }
  try {
    const result = await deps.inspect(parsed.data);
    console.info("cpux.calendar.hospitality.outbox_inventory", {
      actorId, scanned: result.page.scanned, cursor: parsed.data.after ? "present" : "none", asOf: result.asOf,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const diagnostic = safeOutboxInventoryDiagnostic(error);
    console.error("cpux.calendar.hospitality.outbox_inventory_failed", diagnostic);
    return Response.json({ error: "Calendar outbox inventory could not complete the bounded read.", diagnostic }, { status: 409 });
  }
}
