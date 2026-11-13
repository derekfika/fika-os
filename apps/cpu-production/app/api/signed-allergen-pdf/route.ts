import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { productionQueue, productionOrderDetail } from "../../../lib/production-http-client";
import { cpuDestinationAllowed, requireCpuActor, resolveCpuDestinationScope } from "../../../lib/cpu-access-client";
import { createProductionPlanRepository } from "../../../lib/production-plan-repository";
import { isAdHocProductionOrder } from "../../../lib/ad-hoc-order";
import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner, stagingDriveOperationsBlocked } from "@fika/server-shared/drive-owner";
import { getCpuMasterReview } from "../../../lib/cpu-master-review";
import { currentSignedMasterDocument, masterReviewIdentity } from "../../lib/signed-master-document";
import type { MatrixArtifact } from "../../lib/production-plan";
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


async function existingPdfResponse(artifact: MatrixArtifact, owner: ReturnType<typeof resolveDriveOwner>, beforeReturn?: () => Promise<void>) {
    const token = await driveAccessToken(owner);
    await assertStagingDriveResource(artifact.driveFileId!, `Bearer ${token}`);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(artifact.driveFileId!)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw Object.assign(new Error("The current signed PDF could not be retrieved from its governed Drive workspace."), { status: response.status === 404 ? 404 : 503 });
    const bytes = await boundedPdfBytes(response);
    if (bytes.length === 0 || createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash.toLowerCase()) {
      throw Object.assign(new Error("The retrieved PDF did not match the current signed release evidence."), { status: 409 });
    }
    const fileName = artifact.fileName.replace(/[\r\n"\\]/g, "_");
    await beforeReturn?.();
    return new NextResponse(bytes, { headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "x-content-type-options": "nosniff" } });
}
async function handleMasterGet(request: NextRequest) {
  try {
    await requireCpuActor(request);
    const scope = await resolveCpuDestinationScope(request, []);
    if (!scope.allOplocs) throw Object.assign(new Error("The service-date master includes every OPLOC. All-site CPU access is required."), { status: 403 });
    const date = request.nextUrl.searchParams.get("serviceDate") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw Object.assign(new Error("Choose a valid service date."), { status: 422 });
    const load = async () => {
      const orders = (await productionQueue(request, date)).filter(order => order.origin === "menu_planning" && order.status !== "cancelled" && !order.supersededBy && (order.serviceDate || order.requiredBy.slice(0, 10)) === date);
      if (!orders.length || orders.length > 200) throw Object.assign(new Error("No bounded current service-date master is available."), { status: 409 });
      const plans = [];
      // Bound concurrent authoritative reads; no projection rebuild or materialization.
      for (let index = 0; index < orders.length; index += 8) plans.push(...(await Promise.all(orders.slice(index, index + 8).map(order => repository.get(order.canonicalId)))).filter((plan): plan is NonNullable<typeof plan> => Boolean(plan)));
      const identity = masterReviewIdentity(date, orders, plans);
      return currentSignedMasterDocument(date, orders, plans, await getCpuMasterReview(identity.id));
    };
    const master = await load();
    if (await stagingDriveOperationsBlocked()) throw Object.assign(new Error("Signed PDF access is unavailable in this runtime."), { status: 503 });
    if (request.nextUrl.searchParams.get("download") !== "pdf") return NextResponse.json({ state: "ready", serviceDate: date, url: `/api/signed-allergen-pdf?document=master&serviceDate=${encodeURIComponent(date)}&download=pdf` }, { headers: noStore });
    return await existingPdfResponse(master.artifact, resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" }), async () => {
      if ((await load()).identity !== master.identity) throw Object.assign(new Error("The signed master changed while opening. Reload and try again."), { status: 409 });
    });
  } catch (error) { const response = errorResponse(error); for (const [key, value] of Object.entries(noStore)) response.headers.set(key, value); return response; }
}
async function handleGet(request: NextRequest) {
  if (request.nextUrl.searchParams.get("document") === "master") return handleMasterGet(request);
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim();
  if (!orderId || orderId.length > 240) return NextResponse.json({ error: { message: "A valid Production Order ID is required." } }, { status: 422, headers: noStore });
  try {
    const order = await authorizeOrder(request, orderId);
    const plan = await repository.get(orderId);
    const result = signedAllergenDocumentForOrder(plan, order);
    const driveBlocked = result.state === "ready" && await stagingDriveOperationsBlocked();
    if (driveBlocked) return NextResponse.json({ state: "unavailable", message: "Signed PDF access is unavailable until this runtime's Drive isolation is verified." }, { headers: noStore });
    if (request.nextUrl.searchParams.get("download") !== "pdf") return NextResponse.json({ state: result.state, message: result.message, ...(result.state === "ready" ? { url: `/api/signed-allergen-pdf?orderId=${encodeURIComponent(orderId)}&download=pdf` } : {}) }, { headers: noStore });
    if (result.state !== "ready" || !result.artifact) return NextResponse.json({ error: { message: result.message }, state: result.state }, { status: result.state === "unsigned" || result.state === "pending" ? 409 : 404, headers: noStore });

    const owner = isAdHocProductionOrder(order)
      ? resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" })
      : order.origin === "hospitality_booking"
        ? order.destinationOplocId ? resolveDriveOwner({ type: "oploc-workspace", oplocId: order.destinationOplocId }) : undefined
        : resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" });
    if (!owner) return NextResponse.json({ error: { message: "The signed PDF's governed Drive workspace is unavailable." }, state: "unavailable" }, { status: 404, headers: noStore });
    return await existingPdfResponse(result.artifact, owner);
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(noStore)) response.headers.set(key, value);
    return response;
  }
}

export async function GET(request: NextRequest) { return handleGet(request); }
