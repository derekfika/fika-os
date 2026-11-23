import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/internal/ad-hoc/allergen-checker/route";

test("Ad-Hoc checker status and PDF proxy fail closed without the internal service token", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { mode: env.FIKA_RUNTIME_MODE, token: env.FIKA_INTERNAL_API_TOKEN, nodeEnv: env.NODE_ENV };
  env.FIKA_RUNTIME_MODE = "staging";
  env.FIKA_INTERNAL_API_TOKEN = "cpu-service-secret";
  env.NODE_ENV = "test";
  try {
    const status = await GET(new NextRequest("https://cpu.example.test/api/internal/ad-hoc/allergen-checker?orderId=production-order:v1:ad-hoc:req"));
    const pdf = await GET(new NextRequest("https://cpu.example.test/api/internal/ad-hoc/allergen-checker?orderId=production-order:v1:ad-hoc:req&download=pdf", { headers: { "x-fika-internal-token": "wrong" } }));
    assert.equal(status.status, 401);
    assert.equal(pdf.status, 401);
  } finally {
    if (previous.mode === undefined) delete env.FIKA_RUNTIME_MODE; else env.FIKA_RUNTIME_MODE = previous.mode;
    if (previous.token === undefined) delete env.FIKA_INTERNAL_API_TOKEN; else env.FIKA_INTERNAL_API_TOKEN = previous.token;
    if (previous.nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous.nodeEnv;
  }
});
