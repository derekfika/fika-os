#!/usr/bin/env node
/** Refuses to pass while any production App Hosting config could point at staging or still has an unfilled REPLACE_ME_* value. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
const apps = readdirSync("apps").filter((a) => existsSync(`apps/${a}/apphosting.production.yaml`));
const allowPending = process.argv.includes("--allow-pending"); const pending = [];
let bad = 0; const fail = (m) => { console.error("FAIL", m); bad++; };
for (const a of apps) {
  const file = `apps/${a}/apphosting.production.yaml`;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const code = lines.filter((l) => !l.trim().startsWith("#")).join("\n");
  if (/fika-os-dev|-staging|staging-os/.test(code)) fail(`${file}: references staging (${(code.match(/fika-os-dev|[\w.-]*staging[\w.-]*/g) || []).slice(0, 3).join(", ")})`);
  if (!/variable: FIREBASE_PROJECT_ID\s*\n\s*value: fika-os\s*\n/.test(code)) fail(`${file}: FIREBASE_PROJECT_ID must be fika-os`);
  if (!/variable: FIKA_RUNTIME_MODE\s*\n\s*value: production\s*\n/.test(code)) fail(`${file}: FIKA_RUNTIME_MODE must be production`);
  // App Hosting merges apphosting.<env>.yaml over the base apphosting.yaml: a base (staging) variable the production file does not override would leak into production.
  if (existsSync(`apps/${a}/apphosting.yaml`)) { const base = readFileSync(`apps/${a}/apphosting.yaml`, "utf8"); const prodVars = new Set([...code.matchAll(/- variable: (\S+)/g)].map((m) => m[1])); for (const m of base.matchAll(/- variable: (\S+)/g)) if (!prodVars.has(m[1])) fail(`${file}: base apphosting.yaml variable ${m[1]} is not overridden and would leak into production`); }
  const todo = code.match(/REPLACE_ME_\w+/g) || [];
  for (const t of new Set(todo)) { if (/^REPLACE_ME_PENDING_INFRA_/.test(t)) { pending.push(`${file}: ${t}`); if (!allowPending) fail(`${file}: pending infrastructure value ${t}`); } else fail(`${file}: unfilled ${t}`); }
  if (a === "integration-hub" && !/variable: FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED\s*\n\s*value: "false"/.test(code)) fail(`${file}: customer email delivery must be "false" at launch`);
}
console.log(bad ? `\n${bad} problem(s). Production config is NOT ready.` : "Production config OK."); process.exit(bad ? 1 : 0);
