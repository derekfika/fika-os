import { NextRequest, NextResponse } from "next/server";
import { cpuBodyErrorMessage, cpuNotFound, fetchCpuProductionPlan, readCpuJson } from "@/lib/cpu-production";

type CpuPlanBody = {
  plan?: {
    matrixArtifact?: Record<string, unknown>;
    currentAllergenRelease?: Record<string, unknown>;
  };
  matrixStatus?: "generating" | "ready" | "not_configured" | "failed";
  matrixError?: string;
  signedMatrixAvailable?: boolean;
  error?: { message?: string; code?: string };
};

function upstreamFailure(response: Response, body: Record<string, unknown>) {
  return NextResponse.json({ artifact: null, status: "error", error: cpuBodyErrorMessage(body, response.status) }, { status: response.status || 502 });
}

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const productionOrderId = request.nextUrl.searchParams.get("productionOrderId");
  if (!bookingId) return NextResponse.json({ error: { message: "A Booking is required." } }, { status: 400 });
  try {
    const candidates = [...new Set([productionOrderId, bookingId, `production-order:v1:${bookingId}`, `production-order:${bookingId}`].filter(Boolean))] as string[];
    const viewUrlFor = (candidate: string) => `/api/allergen-matrix?bookingId=${encodeURIComponent(bookingId)}&productionOrderId=${encodeURIComponent(candidate)}&view=1`;
    if (request.nextUrl.searchParams.get("view") === "1") {
      for (const candidate of candidates) {
        const response = await fetchCpuProductionPlan(request, candidate, "download=html", { headers: { accept: "text/html, application/json" } });
        if (response.ok) {
          return new NextResponse(await response.text(), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": "inline; filename=\"signed-allergen-matrix.html\"" } });
        }
        const body = await readCpuJson(response);
        if (cpuNotFound(response, body)) continue;
        return upstreamFailure(response, body);
      }
      return NextResponse.json({ error: { message: "The fully signed CPU allergen matrix is not available." } }, { status: 404 });
    }
    for (const candidate of candidates) {
      const response = await fetchCpuProductionPlan(request, candidate);
      const body = await readCpuJson(response) as CpuPlanBody;
      if (!response.ok) {
        if (cpuNotFound(response, body)) continue;
        return upstreamFailure(response, body);
      }
      if (body.plan?.matrixArtifact) {
        const release = body.plan.currentAllergenRelease;
        return NextResponse.json({ artifact: {
          ...body.plan.matrixArtifact,
          viewUrl: viewUrlFor(candidate),
          ...(release?.releaseId ? { releaseId: release.releaseId } : {}),
          ...(release?.version ? { releaseVersion: release.version } : {}),
          ...(release?.sourceContentHash ? { sourceContentHash: release.sourceContentHash } : {}),
        }, status: "ready" });
      }
      if (body.matrixStatus === "failed") return NextResponse.json({ artifact: null, status: "failed", error: body.matrixError || "CPU matrix materialisation failed. Retry materialisation from CPU Production." });
      if (body.matrixStatus === "generating") return NextResponse.json({ artifact: null, status: "generating" });
      if (body.matrixStatus === "not_configured") return NextResponse.json({ artifact: null, status: "not_configured" });
      if (body.matrixStatus === "ready") return NextResponse.json({ artifact: null, status: "error", error: "CPU reports a ready allergen matrix without a persisted artifact." }, { status: 502 });
      if (body.signedMatrixAvailable) return NextResponse.json({ artifact: { fileName: "signed-allergen-matrix.html", driveStatus: "not_configured", viewUrl: viewUrlFor(candidate) }, status: "ready" });
      if (body.plan) return NextResponse.json({ artifact: null, status: "not_configured", error: "The current CPU Production Order has no signed allergen matrix." });
    }
    return NextResponse.json({ artifact: null, status: "not_configured", error: "The current CPU Production Order could not be found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: { message: `CPU Production is unavailable: ${(error as Error).message}` } }, { status: 502 });
  }
}
