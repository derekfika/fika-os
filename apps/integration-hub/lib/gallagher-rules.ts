/** Customer-specific booking rules for Gallagher bookings. */
export const GALLAGHER_EMAIL_DOMAIN = "redington.co.uk";
export const GALLAGHER_MINIMUM_GUESTS = 5;
export const GALLAGHER_MAXIMUM_PRODUCT_MINIMUM = 5;

function normaliseCompany(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]/g, "");
}

export function isGallagherCompany(value: unknown) {
  return normaliseCompany(value) === "gallagher";
}

export function isRedingtonEmail(value: unknown) {
  const email = String(value || "").trim().toLocaleLowerCase("en-GB");
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1) === GALLAGHER_EMAIL_DOMAIN;
}

export function isGallagherBooking(input: { companyName?: unknown; email?: unknown }) {
  return isGallagherCompany(input.companyName) || isRedingtonEmail(input.email);
}

export function capGallagherMinimum(minimum: number, gallagher: boolean) {
  return gallagher ? Math.min(minimum, GALLAGHER_MAXIMUM_PRODUCT_MINIMUM) : minimum;
}
