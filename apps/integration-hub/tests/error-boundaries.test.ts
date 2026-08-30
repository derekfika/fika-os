import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const apps = ["integration-hub", "cpu-production", "menu-planning", "hospitality-booking", "logistics", "delivered-in", "ad-hoc-production"];

test("all launch apps expose a recoverable App Router error boundary", () => {
  for (const app of apps) {
    const path = new URL(`../../${app}/app/error.tsx`, import.meta.url);
    assert.equal(existsSync(path), true, `${app} should have app/error.tsx`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /^"use client";/);
    assert.match(source, /error: Error & \{ digest\?: string \}; reset: \(\) => void/);
    assert.match(source, /onClick=\{\(\) => reset\(\)\}/);
    assert.match(source, /Something went wrong while loading/);
    assert.match(source, /<Link href="\/">/);
    assert.doesNotMatch(source, /error\.message|error\.stack/);
  }
});
