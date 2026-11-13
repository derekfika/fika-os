import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { productionOrderDetail } from "../../../lib/production-http-client";
import { cpuDestinationAllowed, requireCpuActor, resolveCpuDestinationScope } from "../../../lib/cpu-access-client";
import { createProductionPlanRepository } from "../../../lib/production-plan-repository";
import { isAdHocProductionOrder } from "../../../lib/ad-hoc-order";
import { driveAccessToken, resolveDriveOwner, stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { signedAllergenDocumentForOrder } from "../../lib/signed-allergen-document";

export const dynamic = "force-dynamic";
const repository = createProductionPlanRepository();
const noStore = { "cache-control": "no-store, max-age=0", pragma: "no-cache", vary: "cookie" };
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function boundedPdfBytes(response: Response) {
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) {
    throw Object.assign(new Error("The stored signed document is not a PDF."), { status: 409 });
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) throw Object.assign(new Error("The stored signed PDF exceeds the permitted size."), { status: 413 });
  if (!response.body) throw Object.assign(new Error("The stored signed PDF has no content."), { status: 503 });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PDF_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("The stored signed PDF exceeds the permitted size."), { status: 413 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length);
}

async function authorizeOrder(request: NextRequest, orderId: string) {
  await requireCpuActor(request);
  const order = await productionOrderDetail(request, orderId);
  if (!order || order.canonicalId !== orderId) throw Object.assign(new Error("Production Order was not found."), { status: 404 });
  const scope = await resolveCpuDestinationScope(request, order.destinationOplocId ? [order.destinationOplocId] : []);
  if (!cpuDestinationAllowed(scope, order.destinationOplocId, order.destination)) throw Object.assign(new Error("This destination is outside your CPU Production access scope."), { status: 403 });
  if (order.status === "cancelled" || order.supersededBy) throw Object.assign(new Error("This Production Order is no longer current."), { status: 404 });
  return order;
}

async function handleGet(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim();
  if (!orderId || orderId.length > 240) return NextResponse.json({ error: { message: "A valid Production Order ID is required." } }, { status: 422, headers: noStore });
  try {
    const order = await authorizeOrder(request, orderId);
    const plan = await repository.get(orderId);
    const result = signedAllergenDocumentForOrder(plan, order);
    const driveBlocked = result.state === "ready" && await stagingDriveAccessBlocked();
    if (driveBlocked) return NextResponse.json({ state: "unavailable", message: "Signed PDF access is unavailable until this runtime's Drive isolation is verified." }, { headers: noStore });
    if (request.nextUrl.searchParams.get("download") !== "pdf") return NextResponse.json({ state: result.state, message: result.message, ...(result.state === "ready" ? { url: `/api/signed-allergen-pdf?orderId=${encodeURIComponent(orderId)}&download=pdf` } : {}) }, { headers: noStore });
    if (result.state !== "ready" || !result.artifact) return NextResponse.json({ error: { message: result.message }, state: result.state }, { status: result.state === "unsigned" || result.state === "pending" ? 409 : 404, headers: noStore });

    const owner = isAdHocProductionOrder(order)
      ? resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" })
      : order.origin === "hospitality_booking"
        ? order.destinationOplocId ? resolveDriveOwner({ type: "oploc-workspace", oplocId: order.destinationOplocId }) : undefined
        : resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" });
    if (!owner) return NextResponse.json({ error: { message: "The signed PDF's governed Drive workspace is unavailable." }, state: "unavailable" }, { status: 404, headers: noStore });
    const token = await driveAccessToken(owner);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(result.artifact.driveFileId!)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw Object.assign(new Error("The current signed PDF could not be retrieved from its governed Drive workspace."), { status: response.status === 404 ? 404 : 503 });
    const bytes = await boundedPdfBytes(response);
    if (bytes.length === 0 || createHash("sha256").update(bytes).digest("hex") !== result.artifact.contentHash.toLowerCase()) {
      throw Object.assign(new Error("The retrieved PDF did not match the current signed release evidence."), { status: 409 });
    }
    const fileName = result.artifact.fileName.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(bytes, { headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "x-content-type-options": "nosniff" } });
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(noStore)) response.headers.set(key, value);
    return response;
  }
}

export async function GET(request: NextRequest) { return handleGet(request); }
