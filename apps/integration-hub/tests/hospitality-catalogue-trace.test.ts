import assert from "node:assert/strict";
import test from "node:test";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { traceHospitalityCatalogue } from "../lib/hospitality-catalogue-trace";

test("catalogue traces distinguish authority denial, Firestore reads and snapshot access", async () => {
  const previous = process.env.FIKA_DATA_SOURCE_TRACE;
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  const original = console.info;
  const lines: string[] = [];
  console.info = (line: string) => { lines.push(line); };
  try {
    const path = "/api/hospitality-catalogue/public-package";
    const requestId = "047df048-4aac-46f8-b97e-4a584fe68495";
    const request = new Request("https://hub.test" + path, { headers: { "X-Fika-Data-Request-Id": requestId } });
    await traceHospitalityCatalogue(request, "public.manifest", path, async () => {
      recordDataAccess({ operation: "authmod.binding", source: "FIRESTORE", documents: 1 });
      recordDataAccess({ operation: "hospitality-catalogue.public.manifest", source: "SNAPSHOT", documents: 1, packageVersion: 5 });
      return Response.json({});
    });
    await traceHospitalityCatalogue(new Request(request.url, { headers: { "X-Fika-Data-Request-Id": "untrusted header" } }),
      "public.manifest", path, async () => new Response(null, { status: 403 }));

    const prefix = "[FIKA_DATA_TRACE_TOTAL] ";
    const totals = lines.filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
    assert.equal(totals.length, 2);
    assert.equal(totals[0].action, "hospitality-catalogue.public.manifest");
    assert.equal(totals[0].requestId, requestId);
    assert.equal(totals[0].estimatedFirestoreBillableReads, 1);
    assert.equal(totals[0].snapshotRecords, 1);
    assert.equal(totals[0].outcome, "SUCCESS");
    assert.equal(totals[1].outcome, "DENIED");
    assert.equal(totals[1].requestId, undefined);
    assert.equal(totals[1].estimatedFirestoreBillableReads, 0);
  } finally {
    console.info = original;
    if (previous === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE;
    else process.env.FIKA_DATA_SOURCE_TRACE = previous;
  }
});
