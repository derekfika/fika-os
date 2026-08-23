import type { ProductionOrder } from "@hub/lib/production-domain";
import "./booking-context.css";

function present(value: unknown) {
  return value !== undefined && value !== null && value !== "" && value !== false && value !== 0;
}

function entries(values: Record<string, unknown> | undefined) {
  return Object.entries(values || {}).filter(([, value]) => present(value)).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`);
}

export default function BookingContext({ order }: { order: ProductionOrder }) {
  const dietary = entries(order.bookingDietaries).length ? entries(order.bookingDietaries) : [...new Set(order.lines.flatMap((line) => entries(line.dietaries)))];
  const lineNotes = order.lines.flatMap((line) => line.productionInstructions ? [`${line.itemName}: ${line.productionInstructions}`] : []);
  if (!dietary.length && !order.bookingNotes && !lineNotes.length) return null;
  return <section className="cpu-booking-context"><h3>Booking dietary & notes</h3>{dietary.length > 0 && <div><strong>Dietary / allergen requests</strong><ul>{dietary.map((item) => <li key={item}>{item}</li>)}</ul></div>}{order.bookingNotes && <div><strong>Booking notes</strong><p>{order.bookingNotes}</p></div>}{lineNotes.length > 0 && <div><strong>Item notes</strong><ul>{lineNotes.map((item) => <li key={item}>{item}</li>)}</ul></div>}</section>;
}
