import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { productionOrderDetail } from "../../../lib/production-http-client";
import {
  FirestorePackingRepository,
  validatePackingOrder,
} from "../../../lib/packing-checklist";
export const dynamic = "force-dynamic";
const id = z.string().min(1).max(400);
const command = z
  .object({
    orderId: id,
    orderVersion: z.number().int().positive(),
    lineId: id,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    packed: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
    commandId: z.string().uuid(),
  })
  .strict();
async function repository() {
  return new FirestorePackingRepository(
    (await import("../../../lib/firebase-admin")).db,
  );
}
const failure = (e: unknown) => {
  const error = e as Error & { status?: number };
  return NextResponse.json(
    {
      error: {
        message:
          e instanceof z.ZodError
            ? "Invalid packing request."
            : error.status
              ? error.message
              : "Packing could not be saved. Try again.",
      },
    },
    {
      status:
        e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : error.status || 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
};
async function authorisedOrder(request: NextRequest, id: string) {
  const actor = await requireCpuActor(request);
  const order = await productionOrderDetail(request, id);
  if (order.canonicalId !== id)
    throw Object.assign(new Error("Collection identity mismatch."), {
      status: 403,
    });
  validatePackingOrder(order);
  return { actor, order };
}
export async function GET(request: NextRequest) {
  try {
    const { order } = await authorisedOrder(
      request,
      id.parse(request.nextUrl.searchParams.get("orderId")),
    );
    return NextResponse.json(await (await repository()).read(order), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin)
      throw Object.assign(
        new Error("Cross-origin packing updates are not permitted."),
        { status: 403 },
      );
    const c = command.parse(await request.json());
    const { actor, order } = await authorisedOrder(request, c.orderId);
    return NextResponse.json(
      await (await repository()).change(order, c, actor.uid),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
