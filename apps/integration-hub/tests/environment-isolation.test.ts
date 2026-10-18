import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sessionCookieConfig } from "../lib/runtime-config";
import { csrfCookieName, csrfCookieOptions } from "../lib/csrf";

const env = (mode: "staging" | "production"): NodeJS.ProcessEnv => ({ NODE_ENV: "test", FIKA_RUNTIME_MODE: mode, FIREBASE_PROJECT_ID: mode === "staging" ? "fika-os-dev" : "fika-os", FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com" });
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("staging and production sessions use different cookie names on the shared parent domain", () => {
  const staging = sessionCookieConfig(env("staging"));
  const production = sessionCookieConfig(env("production"));
  assert.equal(staging.name, "fika_os_session_staging");
  assert.equal(production.name, "fika_os_session");
  assert.notEqual(staging.name, production.name);
  // Residual exposure, asserted so a future change to the domain is a conscious decision.
  assert.equal(staging.domain, ".fikacatering.com");
  assert.equal(production.domain, ".fikacatering.com");
  assert.equal(staging.secureCookies, true);
});

test("the CSRF cookie is environment-specific so staging cannot overwrite a production token", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  const previousProject = process.env.FIREBASE_PROJECT_ID;
  try {
    Object.assign(process.env, env("staging"));
    assert.equal(csrfCookieName(), "fika_csrf_staging");
    assert.equal(csrfCookieOptions().domain, ".fikacatering.com");
    Object.assign(process.env, env("production"));
    assert.equal(csrfCookieName(), "fika_csrf");
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous;
    if (previousProject === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previousProject;
  }
});

test("session create, verify and delete all resolve the cookie name through the environment config", () => {
  const session = read("../app/api/auth/session/route.ts");
  const local = read("../app/api/auth/local-session/route.ts");
  const csrf = read("../app/api/auth/csrf/route.ts");
  const verify = read("../lib/fika-session.ts");
  assert.doesNotMatch(session, /"fika_os_session"/);
  assert.match(session, /response\.cookies\.set\(sessionCookieConfig\(\)\.name, session/);
  assert.match(session, /response\.cookies\.set\(sessionCookieConfig\(\)\.name, "", clearCookieOptions\(\)\)/);
  assert.match(session, /request\.cookies\.get\(csrfCookieName\(\)\)/);
  assert.match(local, /sessionCookieConfig\(\)\.name/);
  assert.match(csrf, /response\.cookies\.set\(csrfCookieName\(\)/);
  assert.match(verify, /request\.cookies\.get\(sessionCookieConfig\(\)\.name\)/);
});

test("only the Hub creates, reads or clears the session cookie; other apps forward the browser header", () => {
  for (const path of ["../../cpu-production/lib/production-http-client.ts", "../../menu-planning/lib/auth.ts", "../../logistics/lib/auth.ts", "../../delivered-in/lib/server.ts"]) {
    assert.doesNotMatch(read(path), /fika_os_session|cookies\.set\(/, path);
  }
});

test("Hub notification clients to CPU and Logistics approve the destination and refuse redirects", () => {
  for (const path of ["../lib/cpu-projection-client.ts", "../lib/logistics-projection-client.ts"]) {
    const source = read(path);
    assert.match(source, /approvedCredentialedUpstream\(/, path);
    assert.match(source, /redirect: "error"/, path);
  }
});
