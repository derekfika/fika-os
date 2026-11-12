import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { quoteBuffetMenu } from "../lib/quote-buffet-menu";
import { GET as hospitalityMenuPreview } from "../app/api/hospitality-menu-preview/route";

const productionConfig = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");

function buffetFlag(config: string) {
  const match = config.match(/- variable: NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED\r?\n\s+value: "(true|false)"/);
  return match?.[1];
}

test("Hot Fork Buffet remains enabled in staging and disabled for a production release", () => {
  assert.equal(buffetFlag(stagingConfig), "true");
  assert.equal(buffetFlag(productionConfig), "false");
});

test("disabled buffet quote preview performs no request or quote change", async () => {
  const original = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
  process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "false";
  let fetched = false;
  try {
    const result = await quoteBuffetMenu({} as never, async () => {
      fetched = true;
      throw new Error("should not fetch when disabled");
    });
    assert.equal(result, undefined);
    assert.equal(fetched, false);
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
    else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = original;
  }
});

test("disabled buffet menu preview route is private, uncached and unavailable", async () => {
  const original = process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
  process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = "false";
  try {
    const response = await hospitalityMenuPreview(new NextRequest("https://hospitality.test/api/hospitality-menu-preview?date=2026-12-10&oplocId=oploc:rcoa"));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED;
    else process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED = original;
  }
});
