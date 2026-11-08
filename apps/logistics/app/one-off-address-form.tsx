"use client";

import { useState } from "react";
import type { LogisticsProjectionJob } from "../lib/types";

export function OneOffAddressForm({ job, busy, onConfirm }: {
  job: LogisticsProjectionJob;
  busy: boolean;
  onConfirm: (command: object) => void;
}) {
  const [address, setAddress] = useState("");
  return (
    <form onSubmit={event => {
      event.preventDefault();
      if (busy || !address.trim()) return;
      onConfirm({ action: "confirm-menu-one-off-address", jobId: job.id, expectedSourceVersion: job.sourceVersion, address: address.trim() });
    }}>
      <p className="attention-note">Address pending. Confirm it before assigning this delivery.</p>
      <label className="queue-search">
        <span>Delivery address for {job.destinationLabelSnapshot || "this one-off"}</span>
        <input value={address} onChange={event => setAddress(event.target.value)} required maxLength={500} disabled={busy} />
      </label>
      <div className="inspector-actions">
        <button type="submit" disabled={busy || !address.trim()}>{busy ? "Saving…" : "Confirm address"}</button>
      </div>
    </form>
  );
}
