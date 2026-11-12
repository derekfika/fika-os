import { isHotForkBuffetBooking } from "../../shared/hot-fork-buffet";
import type { CanonicalBooking } from "./canonical-types";

type ClientMenuPreview = { available: boolean; date: string; version?: number; weekCommencing?: string; label: string; dishes: Array<{ dishId?: string; name: string; category?: string; description?: string }> };

/** A failed or absent preview is always rendered as the explicit confirmation state in the quote. */
export async function quoteBuffetMenu(booking: CanonicalBooking, fetcher: typeof fetch = fetch): Promise<{ label: string; dishes: ClientMenuPreview["dishes"] } | undefined> {
  if (process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED !== "true") return undefined;
  if (!isHotForkBuffetBooking(booking)) return undefined;
  const confirmed = { label: "Menu to be confirmed", dishes: [] as ClientMenuPreview["dishes"] };
  if (!booking.service.oplocId) return confirmed;
  try {
    const query = new URLSearchParams({ date: booking.service.eventDate, oplocId: booking.service.oplocId });
    const response = await fetcher(`/api/hospitality-menu-preview?${query}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return confirmed;
    const value = await response.json() as Partial<ClientMenuPreview>;
    if (!value.available || !Array.isArray(value.dishes) || !value.dishes.length) return confirmed;
    const dishes = value.dishes.flatMap(item => typeof item?.name === "string" && item.name.trim() ? [{ name: item.name.trim(), ...(typeof item.category === "string" ? { category: item.category } : {}), ...(typeof item.description === "string" ? { description: item.description } : {}) }] : []);
    return dishes.length ? { label: typeof value.label === "string" ? value.label : "Provisional menu", dishes } : confirmed;
  } catch {
    return confirmed;
  }
}
