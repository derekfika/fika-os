"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isLogisticsVehicleId, type LogisticsVehicleId } from "../../shared/logistics-authority";
import { requireSuccessfulResponse } from "../lib/client-errors";

type Catalogue = { vehicles: LogisticsVehicleId[]; loading: boolean; error: string; refresh: () => Promise<void> };
const Context = createContext<Catalogue>({ vehicles: [], loading: true, error: "", refresh: async () => {} });
export function VehicleAuthorityProvider({ children }: { children: ReactNode }) {
  const [vehicles, setVehicles] = useState<LogisticsVehicleId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      try {
        const body = await requireSuccessfulResponse(await fetch("/api/logistics/vehicles", { cache: "no-store" }), "Vehicle authority could not be loaded.") as { permittedVehicleIds?: unknown };
        if (!Array.isArray(body.permittedVehicleIds) || !body.permittedVehicleIds.every(isLogisticsVehicleId) || !body.permittedVehicleIds.length) throw new Error("Vehicle authority unavailable.");
        setVehicles([...new Set(body.permittedVehicleIds)]); setError("");
      } catch { setVehicles([]); setError("Vehicle authority unavailable. Retry before selecting a vehicle."); }
      finally { setLoading(false); }
    })();
    inFlight.current = pending;
    void pending.finally(() => { inFlight.current = undefined; });
    return pending;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Context.Provider value={{ vehicles, loading, error, refresh }}>{children}</Context.Provider>;
}
export const useVehicleAuthority = () => useContext(Context);
