import { logisticsVehicleLabel } from "../../shared/logistics-authority";
import { driverRunLink, type DriverLinkRun } from "../lib/driver-run-link";
import styles from "./classic-driver-views.module.css";

export function ClassicDriverViews({ runs, serviceDate }: { runs: readonly DriverLinkRun[]; serviceDate: string }) {
  const links = runs.flatMap((run, index) => {
    if (run.serviceDate !== serviceDate) return [];
    const link = driverRunLink(run);
    return link ? [{ ...link, runId: run.runId, runNumber: index + 1 }] : [];
  });
  if (!links.length) return null;

  return <div className={styles.links} role="group" aria-label="Driver views">
    {links.map(({ href, vehicleId, runId, runNumber }) => (
      <a key={runId} className={styles.link} href={href}>
        {logisticsVehicleLabel(vehicleId)} driver view{links.length > 1 && ` · Run ${runNumber}`}
      </a>
    ))}
  </div>;
}
