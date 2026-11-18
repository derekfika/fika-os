import type { RollingSnapshot } from "./rolling-menu-types";
import { groupedSlots } from "./week-planner-layout";

export type SelectedMenuWeek = {
  snapshot: RollingSnapshot;
  dates: readonly string[];
  /** Explicitly distinguish browser-only changes from the last saved week. */
  unsavedBrowserDraft?: boolean;
};

const HEADERS = [
  "Week commencing", "Week status", "Service date", "Day", "Category",
  "Menu slot", "Dish", "Portions", "Destination allocations", "Source",
] as const;

function csvCell(value: string | number) {
  const raw = String(value);
  // Spreadsheet formula injection: even text preceded by whitespace can be executable.
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvRow(values: readonly (string | number)[]) {
  return values.map(csvCell).join(",");
}

/**
 * Export exactly the authorised snapshots supplied by the existing Menu Planner
 * read API. This pure function has no publication or operational side effects.
 */
export function menuExportCsv(weeks: readonly SelectedMenuWeek[]) {
  const rows = [csvRow(HEADERS)];
  for (const { snapshot, dates, unsavedBrowserDraft } of weeks) {
    const dayByDate = new Map(snapshot.days.map(day => [day.date, day]));
    const slotGroups = groupedSlots(snapshot);
    const slotPositions = new Map(slotGroups.flatMap(([category, slots], groupIndex) =>
      slots.map((slot, index) => [slot, { category, order: groupIndex * 1000 + index }] as const),
    ));
    const source = unsavedBrowserDraft ? "Unsaved browser draft" : "Saved Menu Planner";
    for (const date of [...new Set(dates)].sort()) {
      const day = dayByDate.get(date);
      if (!day) throw new Error(`The selected date ${date} is missing from week ${snapshot.week.weekCommencing}. Nothing was exported.`);
      const entries = snapshot.entries
        .filter(entry => entry.dayId === day.id && entry.itemLabel.trim())
        .sort((left, right) =>
          (slotPositions.get(left.slot)?.order ?? Number.MAX_SAFE_INTEGER) -
          (slotPositions.get(right.slot)?.order ?? Number.MAX_SAFE_INTEGER)
          || left.id.localeCompare(right.id),
        );
      if (!entries.length) {
        rows.push(csvRow([snapshot.week.weekCommencing, snapshot.week.status, day.date, day.dayName, "", "", "", "", "", source]));
        continue;
      }
      for (const entry of entries) {
        const allocations = entry.allocations.map(allocation =>
          `${allocation.destinationLabel || "Destination"} (${allocation.quantity})`,
        ).join("; ");
        rows.push(csvRow([
          snapshot.week.weekCommencing, snapshot.week.status, day.date, day.dayName,
          slotPositions.get(entry.slot)?.category || "Other", entry.slot,
          entry.itemLabel, entry.portions, allocations, source,
        ]));
      }
    }
  }
  return rows.join("\r\n") + "\r\n";
}
