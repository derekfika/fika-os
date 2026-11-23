import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireBridgeAccess } from "@/lib/hospitality-bridge-auth";
import { hospitalityPortalReadContract } from "@/lib/hospitality-catalogue-service";
import { db } from "@/lib/firebase-admin";
import { studioPilot } from "@/lib/hospitality-studio-pilot";
import { studioPublicationsForBooking } from "@/lib/hospitality-studio-booking";
import { studioChoicePolicy, studioOfferingIsBookable } from "@/lib/hospitality-studio-commercial";
import type { StudioPortalChoices } from "../../../../../shared/hospitality-menu-studio-selection";

const Query = z.object({ oplocId: z.string().min(8), operationalAreaId: z.string().min(8).optional(), serviceDate: z.string().date(), serviceContext: z.string().max(160).optional() });
/** Typed, read-only contract: portals receive governed offerings, never raw Hub records. */
export async function GET(request: NextRequest) {
  try {
    requireBridgeAccess(request);
    const query = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const catalogue = await hospitalityPortalReadContract(query);
    const pilot = studioPilot();
    if (pilot?.oplocId === query.oplocId && query.serviceDate >= pilot.firstDate && query.serviceDate <= pilot.lastDate &&
        process.env.FIKA_STUDIO_HUB_PILOT_BOOKING_ENABLED === "true") {
      const live = await db.runTransaction(transaction => studioPublicationsForBooking(db).choices(
        transaction, query.oplocId, query.serviceDate, catalogue.offerings.map(offering => offering.itemId),
      ), { readOnly: true });
      const offerings = catalogue.offerings.flatMap(offering => {
        if (!live.managedItems.has(offering.itemId)) return [offering];
        const frozen = live.items.get(offering.itemId);
        if (!frozen || !studioOfferingIsBookable(offering, query.serviceDate)) return [];
        const studioChoices: StudioPortalChoices = { publicationHash: frozen.publication.contentHash,
          ...studioChoicePolicy(offering.configuration),
          dishes: frozen.dishes.map(({ dish }) => ({ id: dish.id, name: dish.name, description: dish.customerDescription })) };
        return [{ ...offering, studioChoices }];
      });
      return NextResponse.json({ ...catalogue, offerings }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json(catalogue, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
  catch (error) { return errorResponse(error); }
}
