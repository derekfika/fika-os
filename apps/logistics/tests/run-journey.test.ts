import test from "node:test";
import assert from "node:assert/strict";
import { overlappingRunIds, validateRunJourneyTimes } from "../lib/run-journey";

test("planned CPU times require paired, quarter-hour same-day values", () => {
  assert.equal(validateRunJourneyTimes({ departure: "07:00", returnTime: "16:15" }), undefined);
  assert.match(validateRunJourneyTimes({ departure: "07:10", returnTime: "16:15" }) || "", /15-minute/);
  assert.match(validateRunJourneyTimes({ departure: "07:00" }) || "", /both/);
  assert.match(validateRunJourneyTimes({ departure: "16:00", returnTime: "07:00" }) || "", /later/);
  assert.equal(validateRunJourneyTimes({}), undefined);
});

test("journey overlap warnings include both same-vehicle runs, including nested runs", () => {
  const overlap = overlappingRunIds([
    { canonicalId: "a", vehicleId: "van1", plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "10:00" },
    { canonicalId: "b", vehicleId: "van1", plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "11:00" },
    { canonicalId: "c", vehicleId: "van1", plannedCpuDepartureTime: "07:30", plannedCpuReturnTime: "08:00" },
    { canonicalId: "d", vehicleId: "van2", plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "11:00" },
  ]);
  assert.deepEqual([...overlap].sort(), ["a", "b", "c"]);
});
