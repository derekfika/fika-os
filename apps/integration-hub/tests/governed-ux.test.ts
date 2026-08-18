import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  generateCanonicalId,
  CanonicalIdPrefixes,
} from "../lib/canonical-identities";
import {
  addressApprovalReason,
  canonicalChangeReason,
  completenessDecisionReason,
  lifecycleDecisionReason,
  sourceMappingReason,
} from "../lib/governed-reasons";
import type { EditableEntityType } from "../lib/canonical-editor";

const entityTypes: EditableEntityType[] = [
  "OPLOC",
  "Address",
  "Legend",
  "Employment",
  "Operational Assignment",
  "Operational Capability",
  "Capability Enablement",
];
const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("trusted automatic IDs cover every structured canonical entity", () => {
  const generated = entityTypes.map((entityType) => ({
    entityType,
    id: generateCanonicalId(entityType),
  }));
  for (const item of generated)
    assert.match(
      item.id,
      new RegExp(
        `^${CanonicalIdPrefixes[item.entityType].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[0-9a-f-]{36}$`,
      ),
    );
  assert.equal(
    new Set(generated.map((item) => item.id)).size,
    generated.length,
  );
});

test("ordinary creation forms do not expose editable canonical or relationship IDs", () => {
  const editor = read("app/ui/CanonicalEditorModal.tsx"),
    legacy = read("app/ui/LegacySiteDecisionModal.tsx");
  assert.equal(editor.includes("Immutable canonical ID<input"), false);
  assert.equal(editor.includes("Search or enter stable"), false);
  assert.equal(legacy.includes("Search or enter stable"), false);
  assert.match(editor, /RelationshipSelector/);
  assert.match(legacy, /Find the existing location/);
});

test("no native prompt or confirm remains in application code", () => {
  const files = walk(path.join(process.cwd(), "app")).filter((file) =>
    /\.(ts|tsx)$/.test(file),
  );
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /\bprompt\s*\(/);
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
});

test("Legend review presents safe source and candidate evidence with guided choices", () => {
  const governance = read("app/ui/DataGovernance.tsx"),
    repository = `${read("lib/governance-repository.ts")}\n${read("lib/legend-identity-reconciliation.ts")}`;
  for (const label of [
    "Source person",
    "Work email",
    "Employment",
    "Rota/site evidence",
    "Yes, same person",
    "No, different people",
    "Not sure yet",
  ])
    assert.match(governance, new RegExp(label.replace(/[/?]/g, "\\$&")));
  for (const field of [
    "workEmail",
    "jobTitle",
    "employmentState",
    "externalIdentities",
    "rotaSiteReferences",
    "workLocationReferences",
    "matchExplanation",
  ])
    assert.match(repository, new RegExp(field));
});

test("routine audit reasons are server-owned, factual and preserve optional notes", () => {
  assert.equal(
    canonicalChangeReason({
      entityType: "OPLOC",
      operation: "created",
      label: "Nesta",
    }),
    "Created the OPLOC candidate 'Nesta' from the displayed structured information. Saving did not approve or publish the record.",
  );
  assert.match(
    sourceMappingReason({
      status: "confirmed",
      sourceLabel: "Nesta",
      targetLabel: "Nesta",
      sourceKind: "source location label",
    }),
    /maps to 'Nesta'/,
  );
  assert.match(
    sourceMappingReason({
      status: "rejected",
      sourceLabel: "Alex",
      sourceKind: "person candidate",
    }),
    /different records/,
  );
  assert.match(
    addressApprovalReason("1 Angel Court, London", "Floor checked."),
    /Additional note: Floor checked\./,
  );
  assert.match(
    lifecycleDecisionReason("Nesta", "draft", "needs-review"),
    /draft to needs review/,
  );
  assert.match(
    completenessDecisionReason("Workplace", "mapped-now"),
    /mapped now/,
  );
});

test("country names store governed codes and raw JSON is progressively disclosed", () => {
  const editor = read("app/ui/CanonicalEditorModal.tsx"),
    registry = read("app/ui/DataRegistry.tsx"),
    hub = read("app/ui/Hub.tsx");
  assert.match(
    editor,
    /<option\s+key=\{code\}\s+value=\{code\}>\s*\{countryLabel\(code\)\}/,
  );
  assert.match(editor, /governed country code is stored automatically/i);
  assert.match(registry, /Technical details and raw record/);
  assert.match(hub, /Raw technical data/);
  assert.doesNotMatch(registry, /function Detail\([^)]*\).*<pre>/);
});

test("an unsaved inline Address is presented as a pending joint creation, not a broken reference", () => {
  const editor = read("app/ui/CanonicalEditorModal.tsx");
  assert.match(editor, /inlineAddress\?\.mode === "create"/);
  assert.match(editor, /New address being created/);
  assert.match(
    editor,
    /Address and OPLOC\s+are saved together in one transaction/,
  );
  assert.match(editor, />\s*Add new address\s*<\/button>/);
  assert.doesNotMatch(
    editor,
    /The Address reference does not resolve to an accessible schema-valid Address/,
  );
});

test("Address selection is human-readable with IDs only in technical details", () => {
  const editor = read("app/ui/CanonicalEditorModal.tsx");
  assert.match(editor, /Search building, address, town or postcode/);
  assert.match(editor, /Published reusable Address/);
  assert.match(
    editor,
    /<summary>Technical details<\/summary>\s*<p>\{selected\.canonicalId\}<\/p>/,
  );
  assert.doesNotMatch(editor, /<small>\{selected\.canonicalId\}<\/small>/);
});

test("confirming a genuine Address difference visibly enables the reviewed save path", () => {
  const editor = read("app/ui/CanonicalEditorModal.tsx");
  assert.match(editor, /Confirmed as a genuinely different Address/);
  assert.match(editor, /The prefilled address will be retained/);
  assert.match(
    editor,
    /disabled=\{busy \|\| !preview \|\| !canSave \|\| duplicateReviewBlocked\}/,
  );
  assert.match(editor, /allowDistinctDuplicate/);
});

test("mapped legacy Sites and canonical issues show their governed context", () => {
  const governance = read("app/ui/DataGovernance.tsx"),
    repository = read("lib/governance-repository.ts"),
    hub = read("app/ui/Hub.tsx");
  assert.match(governance, /!site\.mappedOplocId/);
  assert.match(governance, /Mapped OPLOC:/);
  assert.match(governance, /Change mapping/);
  assert.match(governance, /issue\.entityLabel \|\| issue\.entityReference/);
  assert.match(governance, /Open record/);
  assert.match(repository, /entityLabel: canonicalLabel/);
  assert.match(hub, /openRegistry=/);
});

test("resolved location evidence and published OPLOCs leave active governance queues", () => {
  const governance = read("app/ui/DataGovernance.tsx");
  assert.match(
    governance,
    /site\.mappingStatus !== "confirmed" \|\| !site\.mappedOplocId/,
  );
  assert.match(
    governance,
    /!item\.mapping \|\| item\.mapping\.mappingStatus !== "confirmed"/,
  );
  assert.match(
    governance,
    /record\.entityType === "OPLOC" && !record\.alreadyPublished/,
  );
  assert.match(governance, /All legacy Site candidates are mapped/);
  assert.match(governance, /All rota location labels are resolved/);
  assert.match(governance, /No unpublished OPLOCs require attention/);
});

test("legacy lifecycle cleanup is one deterministic administrator action", () => {
  const governance = read("app/ui/DataGovernance.tsx"),
    route = read("app/api/governance/route.ts");
  assert.match(governance, /Publish ready records and resolve lifecycle issues/);
  assert.match(governance, /Ready for automatic publication/);
  assert.match(governance, /technical debt,\s*not a new business decision/);
  assert.match(route, /resolve-legacy-lifecycle/);
  assert.match(route, /canonical\.publish/);
});

function walk(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
