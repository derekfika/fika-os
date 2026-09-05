import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => readFileSync(`${root}/app/ui/${file}`, "utf8");

test("admin mutations open in-app confirmations instead of mutating on the first click", () => {
  const panels = ["EquipmentTypesPanel.tsx", "ServiceCataloguePanel.tsx", "OperationalConfigurationPanel.tsx", "OperationalAreasPanel.tsx", "Connections.tsx", "Hub.tsx"];
  for (const panel of panels) {
    const text = source(panel);
    assert.match(text, /ConfirmationModal/);
    assert.doesNotMatch(text, /window\.confirm\s*\(/);
  }
  assert.match(source("EquipmentTypesPanel.tsx"), /onClick=\{\(\) => setConfirmation\(type\)\}/);
  assert.match(source("Hub.tsx"), /onClick=\{\(\) => setConfirmation\(item\.canonicalId\)\}/);
});

test("confirmation modal provides accessible copy, cancellation, loading protection, and retry-safe confirmation", () => {
  const modal = source("ConfirmationModal.tsx");
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="confirmation-modal-title"/);
  assert.match(modal, /aria-describedby="confirmation-modal-description"/);
  assert.match(modal, /onKeyDown/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /onCancel/);
  assert.match(modal, /disabled=\{busy\}/);
  assert.match(modal, /onClick=\{\(\) => void onConfirm\(\)\}/);
  assert.match(modal, /Working…/);
  assert.match(source("ServiceCataloguePanel.tsx"), /This permanently deletes an unused service type and cannot be undone/);
  assert.match(source("EquipmentTypesPanel.tsx"), /This permanently deletes an unused Equipment Type and cannot be undone/);
});

test("hospitality Booking status changes use an in-app reason modal", () => {
  const bookings = source("HospitalityBookings.tsx");
  assert.doesNotMatch(bookings, /window\.(prompt|confirm|alert)\s*\(/);
  assert.match(bookings, /BookingReasonModal/);
  assert.match(bookings, /Reason <span>\(required\)/);
  assert.match(bookings, /Current status:/);
  assert.match(bookings, /New status:/);
  assert.match(bookings, /disabled=\{busy \|\| !reason\.trim\(\)\}/);
  assert.match(bookings, /event\.key === "Escape"/);
  assert.match(bookings, /opener\.current\?\.focus\(\)/);
  assert.match(bookings, /setSaving\(true\)/);
  assert.match(bookings, /expectedVersion: selected\.version/);
});

test("Integration Hub primary actions use the semantic purple token", () => {
  const styles = readFileSync(`${root}/app/globals.css`, "utf8");
  assert.match(styles, /body \.primary\{background:var\(--color-brand-primary\)!important;color:#fff!important\}/);
});
