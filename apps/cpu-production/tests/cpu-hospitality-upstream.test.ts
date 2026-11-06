import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";
import type { ProductionPlan } from "../app/lib/production-plan";
import { createCpuMasterArtifact, createCpuReleaseArtifacts, getHospitalityMatrixBaseUrl } from "../lib/cpu-release-materialization";
import type { ProductionOrder } from "../lib/production-types";

const staging = "https://hospitality-staging.fikacatering.com";
const production = "https://hospitality.fikacatering.com";
const productionBackend = "https://fika-os-prod-hospitality--fika-os.europe-west4.hosted.app";

test("local CPU keeps its default and configured developer URL", () => {
  assert.equal(getHospitalityMatrixBaseUrl({}), "http://localhost:3300");
  assert.equal(getHospitalityMatrixBaseUrl({
    FIKA_RUNTIME_MODE: "local",
    HOSPITALITY_BOOKING_BASE_URL: " http://127.0.0.1:13300/ ",
  }), "http://127.0.0.1:13300");
});

test("hosted CPU accepts the exact Hospitality origin for its environment", () => {
  assert.equal(getHospitalityMatrixBaseUrl({ FIKA_RUNTIME_MODE: "staging", HOSPITALITY_BOOKING_BASE_URL: staging + "/" }), staging);
  assert.equal(getHospitalityMatrixBaseUrl({ NODE_ENV: "production", HOSPITALITY_BOOKING_BASE_URL: production }), production);
  assert.equal(getHospitalityMatrixBaseUrl({ FIKA_RUNTIME_MODE: "production", HOSPITALITY_BOOKING_BASE_URL: productionBackend }), productionBackend);
  assert.throws(() => getHospitalityMatrixBaseUrl({ NODE_ENV: "production" }), { status: 503, code: "CREDENTIALED_UPSTREAM_REJECTED" });
});

const timestamp = "2026-11-06T10:00:00.000Z";
const order = {
  canonicalId: "production-order:test",
  origin: "hospitality_booking",
  destinationOplocId: "oploc:test",
  sourceBookingId: "booking:test",
  serviceDate: "2026-11-06",
  serviceWindow: { startTime: "12:00" },
  requiredBy: "2026-11-06T12:00:00.000Z",
} as ProductionOrder;
const plan: ProductionPlan = {
  id: "production-plan:test",
  orderId: order.canonicalId,
  status: "planned",
  menuItems: [{
    id: "item:test",
    name: "Test dish",
    note: "",
    subItems: [{
      id: "sub-item:test",
      name: "Test dish",
      note: "",
      quantity: 1,
      evidenceStatus: "completed",
      allergens: Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, key === "milk" ? "contains" : "clear"] as const)),
    }],
  }],
  planningNotes: "",
  signatures: (["production_chef", "head_chef_site_manager"] as const).map(role => ({
    role, printedName: role, signedAt: timestamp, actor: "test-chef", attestation: "Test fixture.",
  })),
  audit: [],
  updatedAt: timestamp,
  updatedBy: "test-chef",
};
const request = new NextRequest("http://localhost/api/production-plan", {
  headers: { cookie: "session=test", "x-fika-internal-token": "test-token" },
});

function setEnvironment(t: TestContext, overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const materializers = [createCpuMasterArtifact, createCpuReleaseArtifacts];

test("both CPU materializers reject unsafe destinations before rendering or forwarding credentials", async t => {
  const unsafe: Array<[string | undefined, string | undefined]> = [
    ["staging", production], ["staging", productionBackend], ["staging", "https://unapproved.example"],
    ["staging", "http://hospitality-staging.fikacatering.com"], ["staging", staging + "/other"],
    ["production", staging], ["production", "not a URL"], ["production", undefined],
    ["unknown", production], [undefined, staging],
  ];
  setEnvironment(t, { NODE_ENV: "production", FIKA_RUNTIME_MODE: undefined, HOSPITALITY_BOOKING_BASE_URL: undefined });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  for (const [mode, destination] of unsafe) {
    if (mode === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = mode;
    if (destination === undefined) delete process.env.HOSPITALITY_BOOKING_BASE_URL;
    else process.env.HOSPITALITY_BOOKING_BASE_URL = destination;
    for (const materialize of materializers) {
      await assert.rejects(() => materialize(structuredClone(plan), order, "test-chef", timestamp, request),
        destination === undefined ? { status: 503 } : { status: 503, code: "CREDENTIALED_UPSTREAM_REJECTED" });
    }
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("both CPU materializers forbid redirects on their credentialed PDF POST", async t => {
  setEnvironment(t, {
    FIKA_RUNTIME_MODE: "staging",
    HOSPITALITY_BOOKING_BASE_URL: staging,
    FIKA_PDF_RENDERER_URL: "https://renderer.example",
    FIKA_PDF_RENDERER_TOKEN: "test-renderer-token",
  });
  let uploads = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url) === "https://renderer.example/render/pdf") return new Response("%PDF-1.4 inert test");
    assert.equal(String(url), staging + "/api/allergen-matrix/drive");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), "session=test");
    assert.equal(headers.get("x-fika-internal-token"), "test-token");
    assert.equal(JSON.parse(String(init?.body)).productionOrderId, order.canonicalId);
    uploads++;
    return Response.json({ error: { message: "Fixture stopped before storage" } }, { status: 503 });
  });
  for (const materialize of materializers) {
    await assert.rejects(() => materialize(structuredClone(plan), order, "test-chef", timestamp, request), /Fixture stopped before storage/);
  }
  assert.equal(uploads, 2);
});
