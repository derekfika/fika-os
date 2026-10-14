import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { csrfCookieName, sessionCookieConfig } from "../lib/runtime-config";

const env = (mode: string, extra: Record<string, string> = {}) => ({ FIKA_RUNTIME_MODE: mode, FIREBASE_PROJECT_ID: mode === "local" ? "demo-fika-os" : `fika-os-${mode}`, ...extra }) as unknown as NodeJS.ProcessEnv;

test("staging and production never share a session or CSRF cookie name, so one browser can hold both", () => {
  const names = ["staging", "production"].map((mode) => sessionCookieConfig(env(mode, { FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com" })).name);
  assert.deepEqual(names, ["fika_os_session_staging", "fika_os_session_production"]);
  assert.notEqual(names[0], names[1]);
  assert.notEqual(csrfCookieName(env("staging")), csrfCookieName(env("production")));
  assert.equal(csrfCookieName(env("production")), "fika_csrf_production");
});

test("the production cookie scope behaviour is unchanged: same domain, secure, lifetime cap", () => {
  const production = sessionCookieConfig(env("production", { FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com" }));
  assert.equal(production.domain, ".fikacatering.com");
  assert.equal(production.secureCookies, true);
  assert.equal(production.maxAge, 7 * 24 * 60 * 60);
  const staging = sessionCookieConfig(env("staging", { FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com" }));
  assert.equal(staging.domain, production.domain);
  assert.equal(staging.maxAge, production.maxAge);
});

test("local mode keeps working and has its own name; no Hub auth route sets or clears a literal cookie name", () => {
  assert.equal(sessionCookieConfig(env("local")).name, "fika_os_session_local");
  for (const file of ["session/route.ts", "local-session/route.ts", "csrf/route.ts"]) {
    const source = readFileSync(new URL(`../app/api/auth/${file}`, import.meta.url), "utf8");
    assert.equal(/cookies\.(set|get)\(\s*["']fika_/.test(source), false, `${file} must use the configured cookie name`);
  }
});
