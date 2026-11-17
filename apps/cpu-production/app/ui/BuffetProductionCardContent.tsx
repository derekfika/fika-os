import { HotForkBuffetChoiceSchema } from "@fika/server-shared/hospitality-buffet-selection";
import type { ProductionOrder } from "../../lib/production-types";
import BuffetOrderChoice, { isBuffetChoice } from "./BuffetOrderChoice";

function serviceDateLabel(date?: string) {
  if (!date) return "Service date not recorded";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function dietaries(order: ProductionOrder) {
  const labels: Record<string, string> = { vegetarian: "Vegetarian", vegan: "Vegan", glutenFree: "Gluten-free", coeliac: "Coeliac", dairyFree: "Dairy-free", halal: "Halal", otherCount: "Other dietary meals", allergyDetails: "Allergy details", freeText: "Dietary notes" };
  return Object.entries(order.bookingDietaries || {}).flatMap(([key, value]) => typeof value === "number" && value > 0 ? [`${labels[key] || key.replaceAll("_", " ")}: ${value}`] : value === true && labels[key] ? [labels[key]] : typeof value === "string" && value.trim() && labels[key] ? [`${labels[key]}: ${value.trim()}`] : []).join(" · ");
}

export function hasHotForkBuffetSelection(order: ProductionOrder) {
  return order.origin === "hospitality_booking" && order.lines.some(line => line.choices?.some(isBuffetChoice));
}

export default function BuffetProductionCardContent({ order }: { order: ProductionOrder }) {
  const choices = order.lines.flatMap(line => line.choices || []).filter(isBuffetChoice);
  const parsed = choices.length === 1 ? HotForkBuffetChoiceSchema.safeParse(choices[0]) : undefined;
  const selection = parsed?.success ? parsed.data.value : undefined;
  const location = [order.serviceLocation?.floorLevel, order.serviceLocation?.roomOrArea].filter(Boolean).join(" · ");
  return <>
    <div className="production-card-top"><strong>HOT FORK BUFFET{selection ? ` · ${selection.packageId.toUpperCase()}` : ""}</strong><span className={`calendar-status calendar-status--${order.status}`}>{order.status.replaceAll("_", " ")}</span></div>
    <div className="production-card-destination"><h3>{order.clientName || "Client not supplied"}</h3></div>
    <div className="production-card-buffet-facts"><span><b>Service</b>{serviceDateLabel(order.serviceDate)} · {order.serviceWindow.startTime}</span><span><b>Site</b>{order.destinationLabel || order.destinationOplocId || "Not assigned"}</span><span><b>Location</b>{location || "Not assigned"}</span><span><b>Guests</b>{order.guestCount?.toLocaleString("en-GB") || "Not recorded"}</span></div>
    {dietaries(order) && <p className="production-card-dietaries"><b>Dietary requirements:</b> {dietaries(order)}</p>}
    {choices.length === 1 ? <BuffetOrderChoice choices={choices} /> : <p className="calendar-exception" role="status">Buffet menu selection needs review: {choices.length ? "duplicate choice evidence" : "saved choice is missing"}.</p>}
  </>;
}
