import { requestedItemLabel, type RequestedItemRow } from "../../lib/booking-presentation";

/** The one chronological list of requested items: time + quantity + item name, with price and any serving notes beneath. */
export function RequestedItemsList({ rows }: { rows: RequestedItemRow[] }) {
  return (
    <ul className="booking-detail__items" aria-label="Requested items in service-time order">
      {rows.map(row => (
        <li key={row.key} data-service-time={row.time}>
          <span>
            <b>{requestedItemLabel(row)}</b>
            {row.routing && <small className="booking-detail__cpu-state" data-cpu-state={row.routing.state}>{row.routing.label}</small>}
            {row.description && <small>{row.description}</small>}
            {row.servingInfo && <small>{row.servingInfo}</small>}
            {row.comments && <small>{row.comments}</small>}
          </span>
          <strong>£{row.net.toFixed(2)}</strong>
        </li>
      ))}
    </ul>
  );
}
