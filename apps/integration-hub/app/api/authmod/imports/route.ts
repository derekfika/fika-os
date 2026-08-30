import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { previewAccessImportAsAdmin } from "@/lib/authmod-core";

async function handleGet(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); return NextResponse.json({ imports: await context.repository.listImports(100) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
async function handlePost(request: NextRequest) { try { const context = await requireAuthmodAdminContext(request); const form = await request.formData(); const file = form.get("file"); if (!(file instanceof File)) throw Object.assign(new Error("Please choose an .xlsx or .csv file."), { status: 422 }); const result = await previewAccessImportAsAdmin(context.repository, { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, actor: context.principal }); return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.imports.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.authmod.imports.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
