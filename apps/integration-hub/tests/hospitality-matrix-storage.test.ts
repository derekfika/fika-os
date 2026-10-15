import assert from "node:assert/strict";
import test from "node:test";
import { hospitalityMatrixStorageContext } from "../lib/hospitality-matrix-storage";
import type { CanonicalRecord } from "../lib/types";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

const sites = [
  { id: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2", portal: "rcoa", folder: "1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X" },
  { id: "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", portal: "angel-court", folder: "1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X" },
];
const oploc = (id: string, values = {}) => ({ canonicalId: id, entityType: "OPLOC", dataHash: "test", publicationStatus: "published", record: { lifecycleState: "active", ...values } } as CanonicalRecord);
const order = (id = sites[0].id) => ({ origin: "hospitality_booking" as const, sourceBookingId: "booking:canonical", destinationOplocId: id });
function fixtures(site = sites[0]) {
  const calls: string[] = [];
  return { calls, reads: {
    booking: async (id: string) => { calls.push(`booking:${id}`); return { canonicalId: id, service: { oplocId: site.id, portalSiteId: site.portal } } as Pick<CanonicalBooking, "canonicalId" | "service">; },
    settings: async (booking: Pick<CanonicalBooking, "service">) => { calls.push(`settings:${booking.service.portalSiteId}`); return { googleMatrixFolderId: site.folder }; },
    oploc: async (id: string) => { calls.push(`oploc:${id}`); return oploc(id); },
  } };
}
for (const site of sites) test(`${site.portal}: governed booking selects only its own dashboard and canonical OPLOC`, async () => {
  const { reads, calls } = fixtures(site);
  assert.deepEqual(await hospitalityMatrixStorageContext(order(site.id), reads), { kind: "hospitality-site", oplocId: site.id, googleMatrixFolderId: site.folder });
  assert.deepEqual(calls, ["booking:booking:canonical", `oploc:${site.id}`, `settings:${site.portal}`]);
});
test("historical OPLOC redirect resolves to the canonical owner key with bounded reads", async () => {
  const { reads, calls } = fixtures();
  reads.oploc = async (id) => { calls.push(`oploc:${id}`); return oploc(id, id === "oploc:historical" ? { lifecycleState: "merged", mergedIntoOplocId: sites[0].id } : {}); };
  assert.equal((await hospitalityMatrixStorageContext(order("oploc:historical"), reads) as { oplocId: string }).oplocId, sites[0].id);
  assert.equal(calls.filter(call => call.startsWith("oploc:")).length, 2);
});
test("cross-site booking/order mismatch rejects before reading dashboard settings", async () => {
  const { reads, calls } = fixtures();
  await assert.rejects(hospitalityMatrixStorageContext(order(sites[1].id), reads), /OPLOCs conflict/);
  assert.equal(calls.some(call => call.startsWith("settings:")), false);
});
test("missing, withdrawn or cyclic canonical identity fails closed", async () => {
  const { reads } = fixtures();
  await assert.rejects(hospitalityMatrixStorageContext(order(), { ...reads, oploc: async () => undefined }), /could not be verified/);
  await assert.rejects(hospitalityMatrixStorageContext(order(), { ...reads, oploc: async id => ({ ...oploc(id), publicationStatus: "withdrawn" }) }), /active canonical OPLOC/);
  await assert.rejects(hospitalityMatrixStorageContext(order(), { ...reads, oploc: async id => oploc(id, { lifecycleState: "merged", mergedIntoOplocId: id }) }), /cycle/);
});
test("site without matrix setting returns canonical context for environment/default resolution", async () => {
  const { reads } = fixtures();
  assert.deepEqual(await hospitalityMatrixStorageContext(order(), { ...reads, settings: async () => ({}) }), { kind: "hospitality-site", oplocId: sites[0].id });
});
test("other and historical CPU origins require no Hospitality reads", async () => {
  const { reads, calls } = fixtures();
  assert.deepEqual(await hospitalityMatrixStorageContext({ ...order(), origin: "cpu_created" }, reads), { kind: "cpu-default" });
  assert.deepEqual(calls, []);
});
