import assert from "node:assert/strict";
import test from "node:test";
import { RCOA_STAGING_DIAGNOSTIC_OPLOC, requireRcoaHospitalityAdminForStagingDiagnostic, stagingDriveDiagnosticAvailable } from "../lib/staging-drive-diagnostic-access";

test("ACL diagnostic is enabled only for the fixed RCoA OPLOC in the development staging project", () => {
  const staging = { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_RCOA_OPLOC_ID: RCOA_STAGING_DIAGNOSTIC_OPLOC };
  assert.equal(stagingDriveDiagnosticAvailable(staging), true);
  assert.equal(stagingDriveDiagnosticAvailable({ ...staging, FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os" }), false);
  assert.equal(stagingDriveDiagnosticAvailable({ ...staging, FIREBASE_PROJECT_ID: "fika-os" }), false);
  assert.equal(stagingDriveDiagnosticAvailable({ ...staging, FIKA_RCOA_OPLOC_ID: "oploc:other" }), false);
});

test("staging Drive ACL diagnostic requires an authenticated session before contacting Hub", async () => {
  let reads = 0;
  await assert.rejects(requireRcoaHospitalityAdminForStagingDiagnostic(null, async () => { reads++; return Response.json({}); }), /authenticated Hospitality Admin session/);
  assert.equal(reads, 0);
});

test("staging Drive ACL diagnostic requires the existing direct RCoA Hospitality Admin grant", async () => {
  const requests: Array<{ path: string; cookie: string | null }> = [];
  const read = async (path: string, cookie: string | null) => {
    requests.push({ path, cookie });
    return Response.json({ hospitalityAdminAuthority: { source: "explicit-company-grant", oplocId: RCOA_STAGING_DIAGNOSTIC_OPLOC } });
  };
  await requireRcoaHospitalityAdminForStagingDiagnostic("session=opaque", read);
  assert.deepEqual(requests, [{ path: `/api/hospitality-bookings?site=rcoa&oploc=${encodeURIComponent(RCOA_STAGING_DIAGNOSTIC_OPLOC)}`, cookie: "session=opaque" }]);
  await assert.rejects(requireRcoaHospitalityAdminForStagingDiagnostic("session=opaque", async () => Response.json({ hospitalityAdminAuthority: { source: "delegated", oplocId: RCOA_STAGING_DIAGNOSTIC_OPLOC } })), /effective RCoA Hospitality Admin grant/);
  await assert.rejects(requireRcoaHospitalityAdminForStagingDiagnostic("session=opaque", async () => Response.json({ hospitalityAdminAuthority: { source: "explicit-company-grant", oplocId: "oploc:other" } })), /effective RCoA Hospitality Admin grant/);
  await assert.rejects(requireRcoaHospitalityAdminForStagingDiagnostic("session=opaque", async () => new Response(null, { status: 403 })), /existing Hospitality access check/);
});
