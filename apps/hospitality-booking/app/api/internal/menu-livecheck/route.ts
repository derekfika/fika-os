// TEMPORARY - staging-only real Google verification of the shared menu path. REMOVE BEFORE MERGE.
import { NextRequest, NextResponse } from "next/server";
import { menuDestinationToken, resolveMenuDestination } from "@fika/server-shared/menu-artifact";
import { runMenuLiveCheck, type LiveCheckGroup } from "@fika/server-shared/menu-livecheck";
import { hubUserFetch } from "@/lib/hub";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MNK = "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f";

export async function POST(request: NextRequest) {
  // Staging only, and only when explicitly enabled for exactly one signed-in operator (identified by the Hub session).
  const allowed = process.env.FIKA_MENU_LIVECHECK_ALLOWED_EMAIL?.trim().toLowerCase();
  if (process.env.FIKA_RUNTIME_MODE !== "staging" || !allowed) return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  try {
    const session = await hubUserFetch("/api/delivered-in/access", request.headers.get("cookie"));
    const body = await session.json().catch(() => ({})) as { access?: { email?: string } };
    if (!session.ok || !body.access?.email) return NextResponse.json({ error: { message: "Sign in to FIKA OS." } }, { status: 401 });
    if (body.access.email.trim().toLowerCase() !== allowed) return NextResponse.json({ error: { message: "Not permitted." } }, { status: 403 });
    const group = request.nextUrl.searchParams.get("group") as LiveCheckGroup;
    const runId = request.nextUrl.searchParams.get("runId") || "";
    if (!["core", "amend", "paging"].includes(group) || !/^[a-z0-9]{6,20}$/.test(runId)) return NextResponse.json({ error: { message: "group (core|amend|paging) and runId ([a-z0-9]{6,20}) are required." } }, { status: 422 });
    const destination = resolveMenuDestination({ oplocId: MNK });
    const report = await runMenuLiveCheck({ destination, token: await menuDestinationToken(destination), group, runId });
    return NextResponse.json({ app: "hospitality", owner: destination.owner.workspaceEmail, authMode: destination.owner.authMode, parentFolderId: destination.parentFolderId, parentSource: destination.parentSource, report });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Live check failed.", code: (error as { code?: string }).code } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
