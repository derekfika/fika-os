import { MenuArtifactError, allergensFromStates, menuSiteKeyForOploc, type NormalizedMenu, type NormalizedMenuItem } from "@fika/server-shared/menu-artifact";
import type { CanonicalBooking } from "./canonical-types";

/** The CPU production plan fields the menu depends on (CPU owns post-handoff menu and allergen truth). */
export type CpuPlanForMenu = {
  id: string;
  status: string;
  updatedAt: string;
  menuItems: Array<{ name: string; subItems: Array<{ name: string; allergens?: Record<string, string> }> }>;
};

const planStatusesThatAreNotCurrent = new Set(["cancelled", "superseded", "withdrawn"]);

/**
 * Hospitality booking -> normalized menu.
 *
 * Only the current accepted state may become a menu: a cancelled booking, a
 * plan that is not Planned (or has been superseded/withdrawn), or any dish whose
 * allergens are unrecorded is refused. Allergens come from the CPU plan, which
 * is derived from the canonical catalogue, never from free text.
 */
export function hospitalityMenuFromBooking(booking: CanonicalBooking, plan: CpuPlanForMenu): NormalizedMenu {
  if (booking.lifecycleStatus === "Cancelled") throw new MenuArtifactError("MENU_BOOKING_CANCELLED", "A cancelled Booking cannot produce a current menu.", 409);
  if (planStatusesThatAreNotCurrent.has(plan.status)) throw new MenuArtifactError("MENU_PLAN_NOT_CURRENT", `The CPU plan is ${plan.status}; its menu is not current.`, 409);
  if (plan.status !== "planned") throw new MenuArtifactError("MENU_PLAN_NOT_PLANNED", "The CPU plan must be marked Planned first.", 409);
  const siteKey = menuSiteKeyForOploc(booking.service.oplocId) || booking.service.portalSiteId?.trim().toLowerCase();
  if (!siteKey) throw new MenuArtifactError("MENU_SITE_REQUIRED", "The Booking has no site identity.", 409);
  const items: NormalizedMenuItem[] = [];
  for (const menuItem of plan.menuItems || []) {
    for (const [index, subItem] of (menuItem.subItems || []).entries()) {
      const name = subItem.name?.trim();
      if (!name) continue;
      if (!subItem.allergens || !Object.keys(subItem.allergens).length) throw new MenuArtifactError("MENU_ALLERGENS_INCOMPLETE", `Allergen information is not complete for "${name}".`, 409);
      const { contains, mayContain, unrecorded, noKeyAllergens } = allergensFromStates(subItem.allergens);
      if (unrecorded.length) throw new MenuArtifactError("MENU_ALLERGENS_UNRECORDED", `"${name}" has unrecorded allergens (${unrecorded.join(", ")}); a menu cannot be printed until they are recorded.`, 409);
      items.push({ id: `${menuItem.name}:${index}:${name}`, name, contains, mayContain, ...(noKeyAllergens ? { noKeyAllergens: true } : {}) });
    }
  }
  const destination = booking.service.portalSiteLabel || booking.service.roomOrArea || booking.service.deliveryPoint || "Destination not assigned";
  const startTime = /^\d{2}:\d{2}$/.test(booking.service.startTime || "") ? booking.service.startTime : undefined;
  return {
    siteKey,
    siteLabel: destination,
    oplocId: booking.service.oplocId,
    serviceDate: booking.service.eventDate,
    ...(startTime ? { serviceTime: startTime } : {}),
    title: "MENU",
    sections: [{ key: "menu", items }],
    source: {
      workflow: "hospitality",
      id: booking.canonicalId,
      version: booking.version,
      // A CPU re-sign or plan change at the same booking version is a newer menu.
      revisionStamp: `${plan.id}@${plan.updatedAt}`,
      clientName: booking.client.companyName,
    },
  };
}
