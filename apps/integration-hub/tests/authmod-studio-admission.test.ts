import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAuthority, resolveUserAccess } from "../lib/authmod-core/evaluator";
import {
  readStudioPreviewAccess, STUDIO_AUTHMOD_APP, STUDIO_PREVIEW_BUNDLE, STUDIO_PREVIEW_RESOURCE, STUDIO_STAGING_ORIGIN,
} from "../lib/authmod-core/hospitality-studio-admission";
import type { AppAssignment, ApplicationRegistryEntry, AuthIdentity, AuthorityGrant } from "../lib/authmod-core/model";
import type { AuthModRepository } from "../lib/authmod-core/repository";

const at = new Date("2026-11-19T10:00:00Z");
const stamps = { version: 1, createdAt: at.toISOString(), updatedAt: at.toISOString() };
const identity: AuthIdentity = {
  ...stamps, id: "fixture:studio-editor", externalProvider: "firebase", externalUid: "fixture:studio-uid",
  displayName: "Fixture editor", identityKind: "person", status: "active", fullAccess: true,
  identityLinkStatus: "matched", provenance: "migration",
};
const session = { authmodIdentityId: identity.id, firebaseUid: identity.externalUid!, identityKind: "person" } as const;
const app: ApplicationRegistryEntry = {
  ...stamps, appId: STUDIO_AUTHMOD_APP, displayName: "Hospitality Menu Studio",
  enabled: true, launchVisible: false, baseUrl: STUDIO_STAGING_ORIGIN, scopeModel: "none",
  standardBundleId: STUDIO_PREVIEW_BUNDLE, standardResource: STUDIO_PREVIEW_RESOURCE, standardActions: ["View"],
  provenance: "migration",
};
const assignment: AppAssignment = {
  ...stamps, id: "fixture:studio-assignment", identityId: identity.id, appId: STUDIO_AUTHMOD_APP,
  status: "active", bundleId: STUDIO_PREVIEW_BUNDLE, source: "standard-app-access",
};
const grant: AuthorityGrant = {
  ...stamps, id: "fixture:studio-view", subjectType: "interactive", subjectId: identity.id, appId: STUDIO_AUTHMOD_APP,
  status: "active", action: "View", resource: STUDIO_PREVIEW_RESOURCE, scope: { kind: "organisation", ids: [] },
  provenance: "explicit-special-authority",
};

function fixture(options: { application?: ApplicationRegistryEntry | null; person?: AuthIdentity; assignments?: AppAssignment[]; grants?: AuthorityGrant[] } = {}) {
  return {
    getApplication: async (id: string) => {
      assert.equal(id, STUDIO_AUTHMOD_APP);
      return options.application === null ? undefined : options.application ?? app;
    },
    readCurrentAccess: async (id: string) => {
      assert.equal(id, identity.id);
      return { identity: options.person ?? identity, appAssignments: options.assignments ?? [assignment], authorityGrants: options.grants ?? [grant] };
    },
  };
}

test("the staging preview returns only the bound person reference and explicit View permission", async () => {
  assert.deepEqual(await readStudioPreviewAccess(fixture(), session, at), {
    principal: { id: identity.id, displayName: identity.displayName }, permissions: { View: true },
  });
  assert.equal(await readStudioPreviewAccess(fixture(), { ...session, identityKind: "operational" }, at), null);
  await assert.rejects(readStudioPreviewAccess(fixture(), { ...session, firebaseUid: "fixture:other-uid" }, at), { status: 503 });
});

test("no preview permission follows an absent app, different return origin or broader registry", async () => {
  for (const application of [
    null, { ...app, enabled: false }, { ...app, launchVisible: true },
    { ...app, baseUrl: "https://os.fikacatering.com" }, { ...app, standardActions: ["View", "Manage"] } satisfies ApplicationRegistryEntry,
  ]) assert.equal(await readStudioPreviewAccess(fixture({ application }), session, at), null);
});

test("Full Access, standard grants, Rotations, delegated access and malformed or expired grants deny View", async () => {
  const cases = [
    { assignments: [] }, { grants: [] }, { person: { ...identity, status: "revoked" } },
    { assignments: [{ ...assignment, accessType: "delegated" }] },
    { grants: [{ ...grant, provenance: "standard-app-access" }] },
    { grants: [{ ...grant, appId: "hospitality-booking", resource: "hospitality.rotations", action: "Publish" }] },
    { grants: [{ ...grant, delegationSourceGrantId: "fixture:delegator" }] },
    { grants: [{ ...grant, scope: { kind: "oploc", ids: ["fixture:site"] } }] },
    { grants: [{ ...grant, effectiveTo: "invalid-date" }] },
    { grants: [{ ...grant, effectiveTo: at.toISOString() }] },
  ] satisfies Parameters<typeof fixture>[0][];
  for (const options of cases) assert.equal(await readStudioPreviewAccess(fixture(options), session, at), null);
});

test("current authority store errors propagate, and generic AUTHMOD cannot admit Studio", async () => {
  const currentError = Object.assign(new Error("fixture package missing"), { status: 503 });
  await assert.rejects(readStudioPreviewAccess({
    ...fixture(), readCurrentAccess: async () => { throw currentError; },
  }, session, at), currentError);
  const principal = { type: "interactive", id: identity.id, displayName: identity.displayName } as const;
  const repository = {} as AuthModRepository;
  assert.equal((await resolveUserAccess(repository, { principal, appId: STUDIO_AUTHMOD_APP })).reasonCode, "app-disabled");
  assert.equal((await evaluateAuthority(repository, {
    principal, appId: STUDIO_AUTHMOD_APP, resource: STUDIO_PREVIEW_RESOURCE, action: "View",
  })).reasonCode, "app-disabled");
});
