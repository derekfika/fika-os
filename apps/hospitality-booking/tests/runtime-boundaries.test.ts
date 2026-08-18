import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("new portal routes use the typed Hub bridge and have no Apps Script or Calendar runtime dependency", () => { const source = readFileSync(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"); assert.match(source, /hubFetch/); assert.doesNotMatch(source, /Apps Script|Spreadsheet|Calendar|Gmail/); });
test("internal dashboard reads the shared canonical Booking API rather than a local copy", () => { const source = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8"); assert.match(source, /api\/dashboard-bookings/); });
