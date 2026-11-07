import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_INGREDIENT_LIBRARY_RESULTS } from "@/lib/ingredient-library";
import { fictionalIngredientLibrary } from "@/lib/ingredient-library-fixture";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(MAX_INGREDIENT_LIBRARY_RESULTS)).optional(),
}).strict();
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    requireLocalBeverageActor(request, "View");
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
      throw Object.assign(new Error("Open the ingredient library from the local Beverage app."), { status: 403, code: "BEVERAGE_INGREDIENT_ORIGIN" });
    }
    const params = url.searchParams;
    if (params.size !== new Set(params.keys()).size) {
      throw Object.assign(new Error("Supply each ingredient library filter once."), { status: 400, code: "BEVERAGE_REQUEST_INVALID" });
    }
    const { q = "", limit = 20 } = querySchema.parse(Object.fromEntries(params));
    const library = fictionalIngredientLibrary();
    return NextResponse.json({ fixture: true, readOnly: true, source: library.source, ...library.search(q, limit) }, { headers });
  } catch (error) {
    const result = beverageError(error);
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
