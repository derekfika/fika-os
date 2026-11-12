"use client";

import { RCOA_FLOORS, rcoaLocationsForFloor } from "@fika/server-shared/rcoa-locations";

export function RcoaLocationFields({
  floor,
  location,
  onFloorChange,
  onLocationChange,
  className,
  floorLabel = "Floor",
  locationLabel = "Location",
  floorRequired = false,
  locationRequired = false,
  floorId,
  locationId,
  floorError,
  locationError,
  floorField,
  locationField,
}: {
  floor: string;
  location: string;
  onFloorChange(value: string): void;
  onLocationChange(value: string): void;
  className?: string;
  floorLabel?: string;
  locationLabel?: string;
  floorRequired?: boolean;
  locationRequired?: boolean;
  floorId?: string;
  locationId?: string;
  floorError?: string;
  locationError?: string;
  floorField?: string;
  locationField?: string;
}) {
  const locations = rcoaLocationsForFloor(floor);
  return <>
    <label className={className}>
      <span>{floorLabel}{floorRequired ? " *" : ""}</span>
      <select id={floorId} data-rcoa-field={floorField} value={floor} required={floorRequired} aria-invalid={Boolean(floorError)} aria-describedby={floorError && floorId ? `${floorId}-error` : undefined} onChange={event => onFloorChange(event.target.value)}>
        <option value="">Choose a floor…</option>
        {RCOA_FLOORS.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      {floorError && <small id={floorId ? `${floorId}-error` : undefined} role="alert">{floorError}</small>}
    </label>
    <label className={className}>
      <span>{locationLabel}{locationRequired ? " *" : ""}</span>
      <select id={locationId} data-rcoa-field={locationField} value={location} required={locationRequired} disabled={!floor} aria-invalid={Boolean(locationError)} aria-describedby={locationError && locationId ? `${locationId}-error` : undefined} onChange={event => onLocationChange(event.target.value)}>
        <option value="">{floor ? "Choose a location…" : "Choose a floor first…"}</option>
        {locations.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      {locationError && <small id={locationId ? `${locationId}-error` : undefined} role="alert">{locationError}</small>}
    </label>
  </>;
}
