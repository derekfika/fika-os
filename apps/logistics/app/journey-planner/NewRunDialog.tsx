"use client";

import { useEffect, useRef, useState } from "react";
import { TruckIcon } from "./icons";
import type { VehicleId } from "./model";
import styles from "./dialog.module.css";

export type NewRunInput = { vehicleId: VehicleId; departure?: string; return?: string };
const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
const onQuarter = (time: string) => /^([01]\d|2[0-3]):(00|15|30|45)$/.test(time);

/** Why these planned CPU times cannot be proposed, or undefined. Mirrors the server's journey-time rules; the server stays authoritative. */
export function journeyTimeProblem(departure: string, returnTime: string): string | undefined {
  if (!departure && !returnTime) return undefined;
  if (!departure || !returnTime) return "Set both departure and return, or leave both empty to plan the times later.";
  if (!onQuarter(departure) || !onQuarter(returnTime)) return "Use 15-minute marks (for example 08:15) up to 23:45.";
  if (minutesOf(returnTime) <= minutesOf(departure)) return "CPU return must be later than departure on the same day.";
  return undefined;
}

/**
 * Create a Run. Franco picks Van 1 or Van 2; times are optional (a Run without times is a draft that is
 * placed on the timeline later). Nothing is persisted until the host confirms the command.
 */
export function NewRunDialog({ vehicles, defaultVehicle, busy = false, onCreate, onClose }: {
  vehicles: Array<{ id: VehicleId; label: string }>;
  defaultVehicle?: VehicleId;
  busy?: boolean;
  onCreate: (input: NewRunInput) => void;
  onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState<VehicleId>(defaultVehicle ?? vehicles[0].id);
  const [departure, setDeparture] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [touched, setTouched] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input[type=radio]:checked")?.focus();
    return () => previous?.focus();
  }, []);
  const problem = journeyTimeProblem(departure, returnTime);
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-run-title" ref={dialog}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <h2 id="new-run-title">New Run</h2>
      <p className={styles.lede}>Choose the vehicle. Planned CPU times are optional; you can place the Run on the timeline or set exact times afterwards.</p>
      <form onSubmit={(event) => { event.preventDefault(); setTouched(true); if (problem || busy) return; onCreate({ vehicleId, ...(departure && returnTime ? { departure, return: returnTime } : {}) }); }}>
        <fieldset className={styles.vehicles}>
          <legend>Vehicle</legend>
          {vehicles.map((vehicle) => <label key={vehicle.id} className={styles.vehicle} data-selected={vehicleId === vehicle.id ? "true" : undefined}>
            <input type="radio" name="vehicle" value={vehicle.id} checked={vehicleId === vehicle.id} onChange={() => setVehicleId(vehicle.id)} />
            <TruckIcon size={20} /><span>{vehicle.label}</span>
          </label>)}
        </fieldset>
        <div className={styles.times}>
          <label>Planned CPU departure<input type="time" step={900} value={departure} onChange={(event) => setDeparture(event.target.value)} aria-invalid={touched && Boolean(problem)} /></label>
          <label>Planned CPU return<input type="time" step={900} value={returnTime} onChange={(event) => setReturnTime(event.target.value)} aria-invalid={touched && Boolean(problem)} /></label>
        </div>
        {(touched || departure || returnTime) && problem && <p className={styles.problem} role="alert">{problem}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Creating…" : "Create Run"}</button>
        </div>
      </form>
    </div>
  </div>;
}
