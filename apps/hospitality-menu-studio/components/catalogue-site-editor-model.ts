import type { CatalogueOffering, CatalogueRow } from "./catalogue-wire";

export type SiteMode = "standard" | "quote_only";

export type SiteValues = {
  available: boolean;
  offering?: CatalogueOffering;
  mode: SiteMode;
  ambiguous: boolean;
};

export type SitePrice = { amount: number; vatRate: number };

export type SiteOverrideDraft = {
  mode: SiteMode;
  price: string;
  vat: string;
  sourceVatRate?: number;
  minimum: string;
  guests: string;
  notice: string;
  displayName: string;
  description: string;
};

export type SiteOverridePatch = {
  offeringMode?: SiteMode;
  price?: SitePrice | null;
  minimumQuantity?: number | null;
  minimumGuests?: number | null;
  noticeRequiredDays?: number | null;
  displayName?: string | null;
  description?: string | null;
};

export function siteValues(row: CatalogueRow, oplocId: string): SiteValues {
  const matches = row.offerings.filter(
    (entry) =>
      entry.oplocId === oplocId &&
      entry.status === "active" &&
      !entry.operationalAreaId,
  );
  const offering = matches.length === 1 ? matches[0] : undefined;
  return {
    available: row.status === "active" && row.availableAt.includes(oplocId),
    offering,
    mode: offering?.mode ?? row.defaultMode ?? "standard",
    ambiguous: matches.length > 1,
  };
}

function rateText(rate: number | undefined): string {
  return rate === undefined
    ? ""
    : (rate * 100).toFixed(4).replace(/\.?0+$/, "");
}

export function siteOverrideDraft(
  row: CatalogueRow,
  { offering, mode }: SiteValues,
): SiteOverrideDraft {
  const price = offering?.price.override;
  const sourceVatRate = price?.vatRate ?? row.defaultPrice?.vatRate;
  return {
    mode,
    price: price?.amount.toFixed(2) ?? "",
    vat: rateText(sourceVatRate),
    sourceVatRate,
    minimum: String(offering?.minimum.override ?? ""),
    guests: String(offering?.minimumGuestsOverride ?? ""),
    notice: String(offering?.noticeRequiredDaysOverride ?? ""),
    displayName: offering?.displayName ?? "",
    description: offering?.description ?? "",
  };
}

function decimal(value: string, label: string, places: 2 | 4) {
  const text = value.trim();
  const amount = Number(text);
  const format =
    places === 2
      ? /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/
      : /^(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/;
  if (!format.test(text) || !Number.isFinite(amount)) {
    throw new Error(
      label +
        " must be a non-negative number with up to " +
        places +
        " decimal places.",
    );
  }
  return amount;
}

function whole(value: string, label: string, minimum: number): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (
    !/^\d+$/.test(value.trim()) ||
    !Number.isSafeInteger(number) ||
    number < minimum
  ) {
    throw new Error(
      label + " must be a whole number of " + minimum + " or more.",
    );
  }
  return number;
}

/**
 * Only include fields the operator changed. Omission leaves an existing site exception intact.
 * A null explicitly resets one field to the company setting.
 */
export function siteOverridePatch(
  before: SiteOverrideDraft,
  after: SiteOverrideDraft,
  companyPrice?: SitePrice,
): SiteOverridePatch {
  const patch: SiteOverridePatch = {};
  if (after.mode !== before.mode) patch.offeringMode = after.mode;

  if (after.mode === "quote_only") {
    if (before.mode !== "quote_only" && before.price.trim()) patch.price = null;
  } else if (
    after.price.trim() !== before.price.trim() ||
    after.vat.trim() !== before.vat.trim()
  ) {
    if (!after.price.trim()) {
      if (before.price.trim()) patch.price = null;
      else throw new Error("Enter a site price before changing its VAT.");
    } else {
      const amount = decimal(after.price, "Site price", 2);
      const percentage = decimal(after.vat, "VAT percentage", 4);
      if (percentage > 100)
        throw new Error("VAT percentage must be between 0 and 100.");
      const beforeVat = before.sourceVatRate ?? Number(before.vat) / 100;
      const vatRate =
        before.vat.trim() && percentage === Number(before.vat)
          ? beforeVat
          : Math.round(percentage * 10_000) / 1_000_000;
      if (
        !before.price.trim() ||
        amount !== Number(before.price) ||
        vatRate !== beforeVat
      ) {
        if (
          amount === companyPrice?.amount &&
          vatRate === companyPrice.vatRate
        ) {
          throw new Error(
            "Leave the site price blank to use the company price and VAT.",
          );
        }
        patch.price = { amount, vatRate };
      }
    }
  }

  if (after.minimum.trim() !== before.minimum.trim()) {
    const minimum = whole(after.minimum, "Minimum quantity", 1);
    if (minimum !== (before.minimum.trim() ? Number(before.minimum) : null))
      patch.minimumQuantity = minimum;
  }
  if (after.guests.trim() !== before.guests.trim()) {
    const guests = whole(after.guests, "Minimum guests", 1);
    if (guests !== (before.guests.trim() ? Number(before.guests) : null))
      patch.minimumGuests = guests;
  }
  if (after.notice.trim() !== before.notice.trim()) {
    const notice = whole(after.notice, "Notice", 0);
    if (notice !== (before.notice.trim() ? Number(before.notice) : null))
      patch.noticeRequiredDays = notice;
  }
  if (after.displayName.trim() !== before.displayName.trim())
    patch.displayName = after.displayName.trim() || null;
  if (after.description.trim() !== before.description.trim())
    patch.description = after.description.trim() || null;
  return patch;
}
