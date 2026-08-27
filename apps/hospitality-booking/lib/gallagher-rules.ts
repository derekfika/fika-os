export const GALLAGHER_EMAIL_DOMAIN = "redington.co.uk";
export const GALLAGHER_MINIMUM_GUESTS = 5;
export const GALLAGHER_MAXIMUM_PRODUCT_MINIMUM = 5;
const normaliseCompany = (value: unknown) => String(value || "").trim().toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "");
export const isGallagherCompany = (value: unknown) => normaliseCompany(value) === "gallagher";
export const isRedingtonEmail = (value: unknown) => { const email = String(value || "").trim().toLocaleLowerCase("en-GB"); return email.slice(email.lastIndexOf("@") + 1) === GALLAGHER_EMAIL_DOMAIN; };
export const isGallagherBooking = (input: { companyName?: unknown; email?: unknown }) => isGallagherCompany(input.companyName) || isRedingtonEmail(input.email);
export const capGallagherMinimum = (minimum: number, gallagher: boolean) => gallagher ? Math.min(minimum, GALLAGHER_MAXIMUM_PRODUCT_MINIMUM) : minimum;
