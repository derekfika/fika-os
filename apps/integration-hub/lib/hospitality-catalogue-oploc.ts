import { isActiveCanonicalOploc } from "./canonical-oplocs";
import type { CanonicalRecord } from "./types";

/** All active FIKA OPLOCs are Hospitality-capable: this is the single "is this location live" predicate for the catalogue. */
export const isActiveOplocRecord = (record: CanonicalRecord) => isActiveCanonicalOploc(record as unknown as Parameters<typeof isActiveCanonicalOploc>[0]);
