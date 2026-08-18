import { NextResponse } from "next/server";
import { hubFetch, isLocalBridgeEnvironment } from "@/lib/hub";
import { localMnkMenuCatalogue } from "@/lib/local-mnk-menu";
import { localAngelCourtMenuCatalogue } from "@/lib/local-angel-court-menu";
import { localCfcMenuCatalogue } from "@/lib/local-cfc-menu";
import { localMunichReMenuCatalogue } from "@/lib/local-munich-re-menu";

function localCompatibilityMenu(siteKey = "mnk") {
  const catalogue =
    siteKey === "angel-court"
      ? localAngelCourtMenuCatalogue
      : siteKey === "cfc"
        ? localCfcMenuCatalogue
        : siteKey === "munich-re"
          ? localMunichReMenuCatalogue
        : localMnkMenuCatalogue;
  return {
    contractVersion: catalogue.schemaVersion,
    source:
      siteKey === "angel-court"
        ? "local-angel-court-brochure-fixture"
        : siteKey === "cfc"
          ? "local-cfc-brochure-fixture"
          : siteKey === "munich-re"
            ? "local-munich-re-generic-brochure-fixture"
          : "local-generated-mnk-fixture",
    menu: catalogue.items
      .filter((item) => item.lifecycleState === "active")
      .map((item) => ({
        canonicalId: item.canonicalId,
        id: item.source.sourceItemId,
        name: item.name,
        description: item.description,
        category: item.category,
        unitPrice: item.pricing.unitPrice,
        vatRate: item.pricing.vatRate,
        dietaryInformation: item.dietaryInformation,
        allergenInformation: item.allergenInformation,
        minimumQuantity: item.orderingConstraints.minimumQuantity,
        minimumGuests: item.orderingConstraints.minimumGuests || undefined,
        noticeRequiredDays: item.orderingConstraints.noticeRequiredDays,
        optionGroups: item.optionGroups,
        servingInfo: item.pricing.servingInfo,
      })),
  };
}

export async function GET(request: Request) {
  const siteKey = new URL(request.url).searchParams.get("site") || "mnk";
  try {
    if (siteKey === "angel-court" || siteKey === "cfc" || siteKey === "munich-re") {
      return NextResponse.json(localCompatibilityMenu(siteKey), {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }
    const oplocId = process.env.FIKA_MNK_OPLOC_ID?.trim();
    if (oplocId) {
      const serviceDate = new Date().toISOString().slice(0, 10);
      const response = await hubFetch(
        `/api/hospitality-menu/portal?oplocId=${encodeURIComponent(oplocId)}&serviceDate=${serviceDate}`,
      );
      const body = await response.json();
      if (!response.ok)
        throw Error(
          body.error?.message || "Governed menu data is unavailable.",
        );
      const menu = (body.offerings || [])
        .filter(
          (offering: Record<string, unknown>) =>
            offering.offeringMode === "standard",
        )
        .map((offering: Record<string, any>) => ({
          canonicalId: offering.itemId,
          id: offering.itemId,
          offeringId: offering.offeringId,
          name: offering.name,
          description: offering.description,
          category: offering.category,
          unitPrice: offering.price.amount,
          vatRate: offering.price.vatRate,
          dietaryInformation: offering.dietaryInformation,
          allergenInformation: offering.allergenInformation,
          minimumQuantity: offering.constraints?.minimumQuantity,
          minimumGuests: offering.constraints?.minimumGuests,
          noticeRequiredDays: offering.constraints?.noticeRequiredDays,
          optionGroups: offering.configuration?.choices?.map(
            (group: Record<string, unknown>) => ({
              id: group.id,
              label: group.label,
              selectionType: group.controlType || "select",
              required: group.required,
              options: group.options,
            }),
          ),
          servingInfo: offering.configuration?.servingInfo,
        }));
      return NextResponse.json(
        { contractVersion: body.contractVersion, source: body.source, menu },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
    const response = await hubFetch("/api/hospitality-menu");
    const body = await response.json();
    if (!response.ok)
      throw Error(body.error?.message || "Canonical menu data is unavailable.");
    const pricedLegacyMenu = Array.isArray(body.menu)
      ? body.menu.filter((item: Record<string, unknown>) =>
          Number.isFinite(Number(item.unitPrice)),
        )
      : [];
    // The older endpoint predates separate Offerings and Prices. Never pass an
    // unpriced Menu Item into this price-dependent booking UI.
    if (pricedLegacyMenu.length > 0) {
      return NextResponse.json(
        { ...body, menu: pricedLegacyMenu },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
    if (!isLocalBridgeEnvironment())
      throw Error("The Canon menu catalogue is empty.");
  } catch (error) {
    if (!isLocalBridgeEnvironment()) {
      return NextResponse.json(
        { error: { message: (error as Error).message } },
        { status: 503 },
      );
    }
  }
  return NextResponse.json(localCompatibilityMenu(siteKey), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
