"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requireSuccessfulResponse } from "../lib/client-errors";
import type { GovernedOploc } from "../lib/upstream";

/** One coalesced read per opened form or legacy display; no catalogue polling. */
export function useMovementLocations(enabled = true) {
  const [oplocs, setOplocs] = useState<GovernedOploc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const flight = useRef<Promise<GovernedOploc[]> | undefined>(undefined);
  const retry = useCallback(async () => {
    setLoading(true); setError("");
    const pending = flight.current || (async () => {
      const response = await fetch("/api/logistics/locations", { cache: "no-store" });
      const body = await requireSuccessfulResponse(response, "Governed locations are temporarily unavailable.");
      if (!Array.isArray(body?.oplocs) || !body.oplocs.length) throw new Error("Governed locations are temporarily unavailable.");
      return body.oplocs as GovernedOploc[];
    })();
    flight.current = pending;
    try { const result = await pending; if (mounted.current) setOplocs(result); }
    catch (cause) { if (mounted.current) { setOplocs([]); setError(cause instanceof Error ? cause.message : "Integration Hub locations are unavailable."); } }
    finally { if (flight.current === pending) flight.current = undefined; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; if (enabled) void retry(); return () => { mounted.current = false; }; }, [retry, enabled]);
  return { oplocs, loading, error, retry };
}
