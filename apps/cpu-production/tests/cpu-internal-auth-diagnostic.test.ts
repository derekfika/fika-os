import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/internal/cpu-release-materialize/route";

function request(token?: string) {
  return new NextRequest("http://localhost/api/internal/cpu-release-materialize", {
    method: "POST",
    headers: {
      ...(token === undefined ? {} : { "x-fika-internal-token": token }),
      "x-fika-delivery-id": "delivery:haleon",
      "x-fika-source-event-id": "release:haleon",
    },
    body: "{}",
  });
}

function requestWithRawToken(token: string) {
  const values = new Map([
    ["x-fika-internal-token", token],
    ["x-fika-delivery-id", "delivery:haleon"],
    ["x-fika-source-event-id", "release:haleon"],
  ]);
  return {
    nextUrl: { pathname: "/api/internal/cpu-release-materialize" },
    headers: { get: (name: string) => values.get(name.toLowerCase()) || null },
  } as unknown as NextRequest;
}

async function withAuthEnv(run: () => Promise<void>) {
  const previousToken = process.env.FIKA_INTERNAL_API_TOKEN;
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  const previousWarnings = console.warn;
  process.env.FIKA_INTERNAL_API_TOKEN = "secret-token";
  process.env.FIKA_RUNTIME_MODE = "staging";
  try { await run(); } finally {
    console.warn = previousWarnings;
    if (previousToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previousToken;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
  }
}

test("correct internal token passes auth without a rejection diagnostic", async () => withAuthEnv(async () => {
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  const response = await POST(request("secret-token"));
  assert.equal(response.status, 422);
  assert.equal(warnings.length, 0);
}));

test("missing internal token logs presence metadata and keeps the safe 401", async () => withAuthEnv(async () => {
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { message: "Internal authentication is required." } });
  const metadata = (warnings[0] as unknown[] | undefined)?.[1] as Record<string, unknown>;
  assert.equal(metadata.configuredPresent, true);
  assert.equal(metadata.suppliedPresent, false);
  assert.equal(metadata.exactMatch, false);
  assert.equal(metadata.trimmedMatch, false);
  assert.equal(metadata.deliveryId, "delivery:haleon");
  assert.equal(metadata.sourceEventId, "release:haleon");
}));

test("wrong and whitespace-wrapped tokens expose only safe comparison metadata", async () => withAuthEnv(async () => {
  for (const supplied of ["wrong-token", "  secret-token  "]) {
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    const response = await POST(supplied.startsWith(" ") ? requestWithRawToken(supplied) : request(supplied));
    assert.equal(response.status, 401);
    const metadata = (warnings[0] as unknown[] | undefined)?.[1] as Record<string, unknown>;
    assert.equal(metadata.configuredPresent, true);
    assert.equal(metadata.suppliedPresent, true);
    assert.equal(metadata.exactMatch, false);
    assert.equal(metadata.trimmedMatch, supplied.trim() === "secret-token");
    assert.equal(metadata.suppliedHasOuterWhitespace, supplied !== supplied.trim());
    const serialized = JSON.stringify([warnings, await response.clone().json()]);
    assert.doesNotMatch(serialized, /secret-token|wrong-token/);
  }
}));
