import type { RunRowView, VehicleId } from "./model";

const minutes = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };

/** Presentation only: each canonical van owns one lane; run and stop identities are untouched. */
export function vehicleTimelineRows(runs: RunRowView[], visibleVehicles: readonly VehicleId[] = ["van1", "van2"]) {
  const vehicles = [{ id: "van1", label: "Van 1" }, { id: "van2", label: "Van 2" }] as const;
  if (runs.some(run => !vehicles.some(vehicle => vehicle.id === run.vehicleId))) throw new Error("A timeline run has an unsupported vehicle identity.");
  return vehicles.filter(vehicle => visibleVehicles.includes(vehicle.id)).map(vehicle => {
    const members = runs.filter(run => run.vehicleId === vehicle.id);
    const ends: number[] = [];
    const tracks = new Map<string, number>();
    const timed = members.filter(run => run.departure && run.return).map((run, index) => ({ run, index, start: minutes(run.departure!), end: minutes(run.return!) })).sort((a, b) => a.start - b.start || a.index - b.index);
    for (const { run, start, end } of timed) {
      let track = ends.findIndex(previousEnd => previousEnd <= start);
      if (track === -1) track = ends.length;
      ends[track] = end;
      tracks.set(run.id, track);
    }
    return { vehicleId: vehicle.id as VehicleId, vehicleLabel: vehicle.label, runs: members, tracks, trackCount: Math.max(1, ends.length) };
  });
}
