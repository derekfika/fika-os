import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("cancellation step markers use dark glyphs on a white disc with a status ring", () => {
  const css = read("../app/ui/CancellationStatusPanel.module.css");
  assert.match(css, /\.steps \.stepDone > span \{[^}]*color: var\(--fika-text-primary\)/);
  assert.doesNotMatch(css, /color: var\(--fika-surface-card\)/);
});

test("group cancel dialog describes ONE consolidated email, never one per service or a delivery promise", () => {
  const group = read("../app/ui/HospitalityGroupDetail.tsx");
  assert.match(group, /one consolidated cancellation email is queued for the whole group, covering the services cancelled here and naming any that remain active/);
  assert.match(group, /A queued email is not a confirmation that it was delivered/);
  assert.doesNotMatch(group, /for each cancelled service/);
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.match(dashboard, /A client cancellation email is queued automatically only where the Hub has customer cancellation email enabled for this site/);
});

test("Sending to CPU is shown only while a CPU send is in flight", () => {
  const panel = read("../app/ui/BookingProductionPanel.tsx");
  assert.match(panel, /sending \? "Sending to CPU…" : label/);
  assert.doesNotMatch(panel, /busy \? "Sending to CPU…"/);
  assert.match(read("../app/ui/HospitalityDashboard.tsx"), /sending=\{actionBusy && actionStage === "Sending to CPU…"\}/);
});

test("group charges report their own loading/saving status; cancel dialog uses UK dates and returns focus", () => {
  const group = read("../app/ui/HospitalityGroupDetail.tsx");
  assert.match(group, /Loading current charges…/);
  assert.match(group, /Saving charges…/);
  assert.match(group, /on \{ukLongDate\(group\.eventDate\)\}/);
  assert.doesNotMatch(group, /on \{group\.eventDate\}/);
  assert.match(group, /cancelWasOpen\.current && !cancelOpen\) cancelButton\.current\?\.focus\(\)/);
});
