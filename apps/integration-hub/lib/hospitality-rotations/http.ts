import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RotationCommand } from "../../../shared/hospitality-rotations";
import { rotationCaller, type RotationAction } from "./auth";
import { RotationStore, rotationProblem } from "./store";
import { getRotationResources } from "./resources";
const noStore = { headers: { "Cache-Control": "private, no-store" } };
const RevisionNumber = z.coerce.number().int().positive();
export function rotationHandlers(store: RotationStore, caller = rotationCaller, resources = getRotationResources) {
  const respond = async (run: () => Promise<unknown>) => {
    try { return NextResponse.json(await run(), noStore); }
    catch (error) {
      const status = error instanceof z.ZodError ? 422 : (error as { status?: number }).status || 503;
      return NextResponse.json({ error: { code: `ROTATIONS_${status}`, message: status >= 500 ? "Rotation authority or storage is unavailable" : error instanceof z.ZodError ? "Rotation request is invalid" : (error as Error).message } }, { status, ...noStore });
    }
  };
  return {
    GET: (request: NextRequest) => respond(async () => {
      const query = request.nextUrl.searchParams;
      const mode = query.get("mode") || "published";
      if (mode === "access") {
        const permissions: Record<RotationAction, boolean> = { View: false, Manage: false, Publish: false };
        for (const action of ["View", "Manage", "Publish"] as const) {
          try { await caller(request, action); permissions[action] = true; }
          catch (error) { if ((error as { status?: number }).status !== 403) throw error; }
        }
        return { permissions };
      }
      if (!["published", "manage", "revision", "resources"].includes(mode)) throw rotationProblem("Unknown read mode");
      if (mode === "resources") {
        await caller(request, "Manage");
        return resources();
      }
      await caller(request, mode === "manage" ? "Manage" : "View");
      if (mode === "manage") {
        const head = await store.head();
        return { head, draft: head.draftRevision ? await store.revision(head.draftRevision) : null };
      }
      if (mode === "revision") {
        const revision = await store.revision(RevisionNumber.parse(query.get("revision")));
        if (revision.status !== "published") throw rotationProblem("Draft revisions require Manage", 403);
        return { revision };
      }
      return store.published(query.get("date") || "");
    }),
    POST: (request: NextRequest) => respond(async () => {
      if (Number(request.headers.get("content-length")) > 750_000) throw rotationProblem("Request too large", 413);
      const body = await request.text();
      if (Buffer.byteLength(body) > 750_000) throw rotationProblem("Request too large", 413);
      let raw;
      try { raw = JSON.parse(body); } catch { throw rotationProblem("Invalid JSON"); }
      const command = RotationCommand.parse(raw);
      const action: RotationAction = command.action === "publish" ? "Publish" : "Manage";
      const principal = await caller(request, action);
      return store.command(principal.id, command);
    }),
  };
}
