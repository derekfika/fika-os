import { effectiveServiceLayout } from "@fika/server-shared/hospitality-service-layout";
import type { RcoaServiceVisibility } from "../../lib/rcoa-service-visibility";

/** Explicit published seed fixture for legacy portal regressions; production consumers never synthesize this context. */
export const seedVisibility: RcoaServiceVisibility = { layout: effectiveServiceLayout(), oplocId: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2" };
