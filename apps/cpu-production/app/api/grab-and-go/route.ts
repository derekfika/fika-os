import { NextRequest, NextResponse } from "next/server";
import { relevantGrabAndGoDates, readGrabAndGoProduction } from "../../../lib/grab-and-go-read";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function sourceOrders() {
  const files = [join(process.cwd(), "..", "delivered-in", "local-data", "delivered-in", "grab-and-go-orders.json"), join(process.cwd(), "apps", "delivered-in", "local-data", "delivered-in", "grab-and-go-orders.json")];
  const file = files.find(existsSync); if (!file) return [];
  try { return (JSON.parse(readFileSync(file, "utf8")) as { orders?: unknown[] }).orders || []; } catch { return []; }
}

export async function GET(request: NextRequest) {
  const orders = sourceOrders() as Parameters<typeof relevantGrabAndGoDates>[0]; const dates = relevantGrabAndGoDates(orders); const today = new Date().toISOString().slice(0, 10); const requested = request.nextUrl.searchParams.get("deliveryDate"); const deliveryDate = requested && dates.includes(requested) ? requested : dates.find(date => date >= today) || dates.at(-1) || today;
  return NextResponse.json({ deliveryDate, dates, production: readGrabAndGoProduction(deliveryDate) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
