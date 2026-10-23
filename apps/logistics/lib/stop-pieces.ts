import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { PlannerDay } from "./planner-read-model";
import type { StopPiece } from "./run-stop-order";
import type { DeliveryStop, LogisticsDayProjection } from "./types";

type PlannerRun = PlannerDay["runs"][number];

/**
 * Individually tracked pieces of work inside each physical stop of a run, derived from canonical loads /
 * movements (never from display names). One implementation shared by the classic Inspector and the
 * Journey Planner V3 inspector.
 */
export function stopPiecesForRun(
  run: PlannerRun,
  context: { projection?: LogisticsDayProjection; rawStops: DeliveryStop[]; rawRequirements: FulfilmentRequirement[]; movements: PlannerDay["movements"] },
): Record<string, StopPiece[]> {
  const { projection, rawStops, rawRequirements, movements } = context;
  return Object.fromEntries(run.stops.map((item): [string, StopPiece[]] => {
    if (item.stopId.startsWith("projection-stop:")) {
      const lane = item.stopId.startsWith("projection-stop:collection:") ? "collection" as const : "delivery" as const;
      const anchor = item.stopId.slice(`projection-stop:${lane}:`.length);
      const group = projection?.deliveryLoads.find((load) => load.id === anchor || (load.loadIds || []).includes(anchor));
      const ids = group?.loadIds?.length ? group.loadIds : group ? [group.id] : [];
      const found = ids.flatMap((id) => {
        const jobs = group!.jobs.filter((job) => job.assignedLoadId === id || (ids.length === 1 && !job.assignedLoadId));
        return jobs.length ? jobs.map((job) => ({ key: job.id, kind: lane, label: job.contents.map((content) => `${content.quantity} ${content.unit} ${content.description}`).join(", ") || item.destination.label })) : [{ key: id, kind: lane, label: item.destination.label }];
      });
      return [item.stopId, found];
    }
    const raw = rawStops.find((candidate) => candidate.canonicalId === item.stopId);
    const fromMovements = (raw?.movementRequestIds || []).flatMap((id) => {
      const movement = movements.find((candidate) => candidate.movementId === id);
      return movement ? [{ key: id, kind: movement.type, label: movement.items.map((line) => `${line.quantity} × ${line.description}`).join(", ") }] : [];
    });
    const fromRequirements = (raw?.requirementRefs || []).map((ref) => ({ key: ref.requirementId, kind: (raw?.linkedOperation === "collection" ? "collection" : "delivery") as StopPiece["kind"], label: rawRequirements.find((requirement) => requirement.canonicalId === ref.requirementId)?.lines.map((line) => line.displayNameSnapshot).join(", ") || item.destination.label }));
    return [item.stopId, [...fromRequirements, ...fromMovements]];
  }));
}
