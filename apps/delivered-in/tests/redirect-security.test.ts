import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import test from "node:test";
import { NextRequest } from "next/server";
import { getGrabAndGoCatalogueManifest } from "../lib/grab-and-go-catalogue-client";
import { googleFetch } from "../lib/google-site-menu";
import { forwardProductionMaterialisation } from "../lib/production-client";
import { readAuthoritativeMenuPublications, resolveAccess } from "../lib/server";

type CapturedRequest = { method?: string; headers: IncomingMessage["headers"]; body: string };

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind to a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function redirectFixture(status: number) {
  const destinationRequests: CapturedRequest[] = [];
  const destination = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      destinationRequests.push({ method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  const destinationBase = await listen(destination);
  const originalRequests: CapturedRequest[] = [];
  const original = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      originalRequests.push({ method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(status, { location: `${destinationBase}/redirect-target`, "content-type": "application/json" });
      response.end(JSON.stringify({ redirected: true }));
    });
  });
  const originalBase = await listen(original);
  return { original, destination, originalBase, originalRequests, destinationRequests };
}

const handoff = {
  sourceDomain: "grab-and-go" as const,
  sourceEntityId: "grab-and-go:site:one:2026-10-19",
  sourceVersion: 1,
  destinationOplocId: "oploc:site-one",
  destinationLabel: "One",
  serviceDate: "2026-10-19",
  requiredBy: "2026-10-19T08:00",
  status: "submitted" as const,
  lines: [{ sourceLineId: "line-1", canonicalItemId: "grab:item-1", itemName: "Fruit pot", quantity: 2, unit: "item", workstream: "grab_and_go" as const }],
};

test("credential-bearing Delivered-In fetches reject real 302, 307 and 308 redirects", async () => {
  const originalEnv = {
    mode: process.env.FIKA_RUNTIME_MODE,
    hub: process.env.INTEGRATION_HUB_BASE_URL,
    menu: process.env.MENU_PLANNING_BASE_URL,
    cpu: process.env.CPU_PRODUCTION_BASE_URL,
    token: process.env.FIKA_INTERNAL_API_TOKEN,
  };
  process.env.FIKA_RUNTIME_MODE = "development";
  process.env.FIKA_INTERNAL_API_TOKEN = "fixture-internal-token";

  const cases = [
    {
      name: "Hub session cookie and POST body on 307",
      status: 307,
      configure: (base: string) => { process.env.INTEGRATION_HUB_BASE_URL = base; },
      invoke: (base: string) => forwardProductionMaterialisation(handoff),
      expectedHeader: ["x-fika-internal-token", "fixture-internal-token"] as const,
      expectedMethod: "POST",
      expectedBody: JSON.stringify(handoff),
    },
    {
      name: "Hub session cookie on 302",
      status: 302,
      configure: (base: string) => { process.env.INTEGRATION_HUB_BASE_URL = base; },
      invoke: (base: string) => resolveAccess(new NextRequest("http://delivered-in.test/api/access", { headers: { cookie: "fika_hub_token=fixture-cookie" } })),
      expectedHeader: ["cookie", "fika_hub_token=fixture-cookie"] as const,
      expectedMethod: "GET",
      expectedBody: "",
    },
    {
      name: "Menu session cookie on 308",
      status: 308,
      configure: (base: string) => { process.env.MENU_PLANNING_BASE_URL = base; },
      invoke: (base: string) => readAuthoritativeMenuPublications(new NextRequest("http://delivered-in.test/api/menu", { headers: { cookie: "fika_hub_token=fixture-cookie" } }), "2026-10-19", "2026-10-26"),
      expectedHeader: ["cookie", "fika_hub_token=fixture-cookie"] as const,
      expectedMethod: "GET",
      expectedBody: "",
    },
    {
      name: "CPU internal token on 307",
      status: 307,
      configure: (base: string) => { process.env.CPU_PRODUCTION_BASE_URL = base; },
      invoke: (_base: string) => getGrabAndGoCatalogueManifest(),
      expectedHeader: ["x-fika-internal-token", "fixture-internal-token"] as const,
      expectedMethod: "GET",
      expectedBody: "",
    },
    {
      name: "Google API bearer credential on 302",
      status: 302,
      configure: (_base: string) => {},
      invoke: (base: string) => googleFetch(`${base}/api/drive`, { headers: { authorization: "Bearer fixture-google-token" } }, "fixture Google API request"),
      expectedHeader: ["authorization", "Bearer fixture-google-token"] as const,
      expectedMethod: "GET",
      expectedBody: "",
    },
  ];

  try {
    for (const scenario of cases) {
      const fixture = await redirectFixture(scenario.status);
      try {
        scenario.configure(fixture.originalBase);
        await assert.rejects(scenario.invoke(fixture.originalBase));
        assert.equal(fixture.originalRequests.length, 1, `${scenario.name}: request did not reach the approved first destination`);
        assert.equal(fixture.originalRequests[0].method, scenario.expectedMethod);
        assert.equal(fixture.originalRequests[0].headers[scenario.expectedHeader[0]], scenario.expectedHeader[1]);
        assert.equal(fixture.originalRequests[0].body, scenario.expectedBody);
        assert.equal(fixture.destinationRequests.length, 0, `${scenario.name}: redirect target received a request`);
      } finally {
        await close(fixture.original);
        await close(fixture.destination);
      }
    }
  } finally {
    for (const [key, value] of Object.entries({ FIKA_RUNTIME_MODE: originalEnv.mode, INTEGRATION_HUB_BASE_URL: originalEnv.hub, MENU_PLANNING_BASE_URL: originalEnv.menu, CPU_PRODUCTION_BASE_URL: originalEnv.cpu, FIKA_INTERNAL_API_TOKEN: originalEnv.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
