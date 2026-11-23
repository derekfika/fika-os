import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../../shared/internal-auth";
import { productionOrderDetail } from "@/lib/production-http-client";
import { createProductionPlanRepository } from "@/lib/production-plan-repository";
import { isAdHocProductionOrder } from "@/lib/ad-hoc-order";
import { signedAllergenDocumentForOrder } from "@/app/lib/signed-allergen-document";
import { assertStagingDriveResource, driveAccessToken, resolveDriveOwner, stagingDriveOperationsBlocked } from "@fika/server-shared/drive-owner";

export const dynamic = "force-dynamic";
const repository = createProductionPlanRepository();
const noStore = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function current(request: NextRequest, orderId: string) {
  const order = await productionOrderDetail(request, orderId);
  if (!order || order.canonicalId !== orderId || !isAdHocProductionOrder(order)) throw Object.assign(new Error("The originating Ad-Hoc order was not found."), { status: 404 });
  const plan = await repository.get(orderId);
  const document = signedAllergenDocumentForOrder(plan, order);
  const release = plan?.currentAllergenRelease;
  return {
    order, plan, document,
    status: {
      state: order.status === "cancelled" || order.supersededBy ? "revoked" : document.state,
      ...(release ? {
        releaseId: release.releaseId,
        releaseVersion: release.version,
        sourceRevision: release.sourceRevision || release.sourceVersion,
        sourceVersion: release.sourceVersion,
        sourceContentHash: release.sourceContentHash,
        signedAt: release.signedAt,
        signatures: release.signatures.filter(signature => signature.valid).map(({ role, printedName, signedAt }) => ({ role, printedName, signedAt })),
      } : {}),
    },
  };
}

async function pdfResponse(request: NextRequest, orderId: string) {
  const selected = await current(request, orderId);
  if (selected.document.state !== "ready" || !selected.document.artifact || !selected.plan?.currentAllergenRelease) return NextResponse.json({ error: { message: selected.document.message }, state: selected.document.state }, { status: 409, headers: noStore });
  if (await stagingDriveOperationsBlocked()) return NextResponse.json({ error: { message: "Signed PDF access is unavailable in this runtime." } }, { status: 503, headers: noStore });
  const artifact = selected.document.artifact;
  const owner = resolveDriveOwner({ type: "app-workspace", appId: "cpu-production" });
  const token = await driveAccessToken(owner);
  await assertStagingDriveResource(artifact.driveFileId!, `Bearer ${token}`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(artifact.driveFileId!)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw Object.assign(new Error("The current signed PDF could not be retrieved from its governed Drive workspace."), { status: response.status === 404 ? 404 : 503 });
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) throw Object.assign(new Error("The stored signed document is not a PDF."), { status: 409 });
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_PDF_BYTES) throw Object.assign(new Error("The stored signed PDF exceeds the permitted size."), { status: 413 });
  if (!response.body) throw Object.assign(new Error("The stored signed PDF has no content."), { status: 503 });
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PDF_BYTES) { await reader.cancel(); throw Object.assign(new Error("The stored signed PDF exceeds the permitted size."), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
  if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash.toLowerCase()) throw Object.assign(new Error("The retrieved PDF did not match the current signed release evidence."), { status: 409 });
  const rechecked = await current(request, orderId);
  if (rechecked.document.state !== "ready" || rechecked.plan?.currentAllergenRelease?.releaseId !== selected.plan.currentAllergenRelease.releaseId || rechecked.document.artifact?.contentHash !== artifact.contentHash) throw Object.assign(new Error("The signed release changed while opening. Reload and try again."), { status: 409 });
  const fileName = artifact.fileName.replace(/[\r\n"\\]/g, "_");
  return new NextResponse(bytes, { headers: { ...noStore, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"` } });
}

export async function GET(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal CPU access is not authorised." } }, { status: 401, headers: noStore });
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() || "";
  if (!orderId || orderId.length > 240) return NextResponse.json({ error: { message: "A valid Production Order ID is required." } }, { status: 422, headers: noStore });
  try {
    if (request.nextUrl.searchParams.get("download") === "pdf") return await pdfResponse(request, orderId);
    return NextResponse.json((await current(request, orderId)).status, { headers: noStore });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Allergen checker status is unavailable." } }, { status, headers: noStore });
  }
}
