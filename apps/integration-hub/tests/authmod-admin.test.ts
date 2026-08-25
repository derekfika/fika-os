import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildAuthmodAccounts } from "../lib/authmod-admin-read-model";
import { MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantStandardApplicationAccess, assignSite, grantAuthmodAdmin, previewAccessImport } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";

const admin: AuthPrincipal = { type: "interactive", id: "actor:admin", displayName: "Local AUTHMOD Administrator", identityKind: "person" };
const repo = () => new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:example", label: "Example Site", active: true }] });

test("AUTHMOD account read model distinguishes operational representation from actual site authorization", async () => {
  const repository = repo(); const operational = await createAuthIdentity(repository, { actor: admin, displayName: "FIKA @ Example Site", email: "example-account@example.test", externalProvider: "workspace", externalUid: "workspace:example", identityKind: "operational", representedOplocId: "oploc:example", provenance: "import" });
  const [row] = await buildAuthmodAccounts(repository); assert.equal(row.identity.identityKind, "operational"); assert.equal(row.identity.representedOplocLabel, "Example Site"); assert.deepEqual(row.sites, []); assert.equal(row.fullAccess, false); void operational;
});

test("raw Workspace export columns are accepted and remain unresolved until reviewed", async () => {
  const repository = repo(); const operator = await createAuthIdentity(repository, { actor: admin, displayName: "Import Operator", email: "operator@example.test", externalProvider: "workspace", externalUid: "workspace:operator", provenance: "migration" }); await grantAuthmodAdmin(repository, { identityId: operator.id, actor: admin, reason: "Import administrator." }); const actor: AuthPrincipal = { type: "interactive", id: operator.id, displayName: operator.displayName, identityKind: "person" };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ "First Name": "Example", "Last Name": "Account", "Email Address": "example-account@example.test", Status: "Active", "Last Sign In": "2026-08-25", "Email Usage": "Used" }]), "Users");
  const preview = await previewAccessImport(repository, { buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })), filename: "workspace-export.xlsx", actor });
  assert.equal(preview.resolutions[0].input.Email, "example-account@example.test"); assert.equal(preview.resolutions[0].input.DisplayName, "Example Account"); assert.equal(preview.resolutions[0].confidence, "unmatched"); assert.equal(preview.resolutions[0].decision, undefined);
});

test("admin read model exposes only explicit sites and app bundles", async () => {
  const repository = repo(); const person = await createAuthIdentity(repository, { actor: admin, displayName: "Example Person", email: "person@example.test", externalProvider: "workspace", externalUid: "workspace:person", identityKind: "person", provenance: "migration" }); await assignSite(repository, { identityId: person.id, oplocId: "oploc:example", actor: admin, reason: "Reviewed site access." }); await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "logistics", actor: admin });
  const [row] = await buildAuthmodAccounts(repository); assert.deepEqual(row.sites, [{ id: "oploc:example", label: "Example Site" }]); assert.deepEqual(row.apps, [{ id: "logistics", label: "Logistics" }]);
});
