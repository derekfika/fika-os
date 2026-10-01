"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LogisticsDriverOption, LogisticsVehicleId } from "../../shared/logistics-authority";
import { requireSuccessfulResponse } from "../lib/client-errors";

type Catalogue = { drivers: LogisticsDriverOption[]; vehicles: LogisticsVehicleId[]; loading: boolean; error: string; refresh: () => Promise<void> };
const Context = createContext<Catalogue>({ drivers: [], vehicles: [], loading: true, error: "", refresh: async () => {} });
export function DriverAuthorityProvider({ children }: { children: ReactNode }) {
  const [drivers, setDrivers] = useState<LogisticsDriverOption[]>([]);
  const [vehicles, setVehicles] = useState<LogisticsVehicleId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const loaded = useRef(false);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      if (!loaded.current) setLoading(true);
      try {
        const body = await requireSuccessfulResponse(await fetch("/api/logistics/drivers", { cache: "no-store" }), "Driver choices could not be loaded.") as { drivers: LogisticsDriverOption[]; permittedVehicleIds: LogisticsVehicleId[] };
        setDrivers(body.drivers); setVehicles(body.permittedVehicleIds); setError(""); loaded.current = true;
      } catch { setDrivers([]); setError("Driver choices unavailable. Retry before assigning a driver."); }
      finally { setLoading(false); }
    })();
    inFlight.current = pending;
    void pending.finally(() => { inFlight.current = undefined; });
    return pending;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Context.Provider value={{ drivers, vehicles, loading, error, refresh }}>{children}</Context.Provider>;
}
export const useDriverAuthority = () => useContext(Context);
export function DriverSelector({ vehicleId, driverId, historicalLabel, disabled, onChange }: { vehicleId?: LogisticsVehicleId; driverId?: string; historicalLabel?: string; disabled?: boolean; onChange: (id: string) => void }) {
  const catalogue = useDriverAuthority();
  const options = catalogue.drivers.filter(driver => vehicleId && driver.permittedDriverVehicleIds.includes(vehicleId));
  const historical = driverId && !catalogue.loading && !options.some(driver => driver.driverId === driverId);
  return <div className="run-driver-control">
    <label>Driver <select aria-label="Driver" value={driverId || ""} disabled={disabled || catalogue.loading || Boolean(catalogue.error) || !vehicleId} onFocus={() => { void catalogue.refresh(); }} onChange={event => { if (event.target.value) onChange(event.target.value); }}>
      <option value="">{catalogue.loading ? "Loading drivers…" : "Select driver"}</option>
      {historical && <option value={driverId} disabled>{historicalLabel || driverId} · no longer eligible</option>}
      {options.map(driver => <option key={driver.driverId} value={driver.driverId}>{driver.displayName}</option>)}
    </select></label>
    {catalogue.error && <p role="alert">{catalogue.error} <button type="button" className="secondary" onClick={() => void catalogue.refresh()}>Retry drivers</button></p>}
    {!vehicleId && <p role="status">Vehicle identity needs administrator review.</p>}
    {historical && !catalogue.error && <p role="status">The assigned driver needs review. The historical assignment is preserved.</p>}
    {!catalogue.loading && !catalogue.error && vehicleId && !options.length && <p role="status">No eligible drivers for this vehicle.</p>}
  </div>;
}
