# Stage 7 Increment 1 Technical Completion Review

**Review date:** 2026-07-27

**Increment:** Shadow CPU Production intake and reconciliation

**Primary verdict:** **NOT TECHNICALLY COMPLETE — OFFLINE SEAM**

## 1. Review scope and authority

This review assesses only the committed offline package at `C:\FIKA\tools\cpu-shadow-reconciliation`. It determines whether implementation commit `f18574c003c228a5d8d804e7467b79d94103bd8d` completes the single first-code task authorised by the [before-first-code review](stage-7-increment-1-before-first-code-review-2026-07-27.md) and [Increment 1 charter](stage-7-increment-1-shadow-cpu-production-charter.md).

The review is governed by `C:\FIKA\fika-platform-specs\AGENTS.md`. It authorises governance Markdown and disposable verification output only. It does not authorise an implementation correction, provider access, live or sanitised extraction, canonical persistence, deployment, hosting or Stage 8 entry.

## 2. Repositories and commits reviewed

| Repository | Starting state | Ending state before review commit | Review treatment |
|---|---|---|---|
| FIKA OS implementation, `C:\FIKA` | Branch `design/fika-impact-visual-refactor`; HEAD `f18574c003c228a5d8d804e7467b79d94103bd8d` | Same branch and HEAD | Read-only except ignored package-local dependency installation; nothing staged or committed |
| Governed specifications, `C:\FIKA\fika-platform-specs` | Clean at `252b5ed8931cfd925f93987a14f0db967b055567` | Review documentation only before commit | Independent governance repository |

The implementation commit has parent `7ffb7bf5e8114195406fd994c272ecaf74732e88` and contains exactly 19 files, all beneath `tools/cpu-shadow-reconciliation`. Pre-existing outer-repository changes were recorded before verification and remained untouched.

## 3. Applicable governance sources

- [Before-first-code review](stage-7-increment-1-before-first-code-review-2026-07-27.md)
- [Increment 1 charter](stage-7-increment-1-shadow-cpu-production-charter.md)
- [Stage 7 implementation](stage-7-implementation.md)
- [Schema versioning and compatibility](../engineering/schema-versioning-and-compatibility.md)
- [Testing strategy](../engineering/testing-strategy.md)
- [Definition of Done](../engineering/definition-of-done.md)
- [ADR-004 — Booking-to-Production boundary](../decisions/ADR-004-booking-to-production-boundary.md)
- [Pack 6 traceability](../schema-reviews/pack-6-bdr-to-schema-traceability.md) and all four Pack 6 schemas
- `PROD-001` through `PROD-005`, `LOC-001`, `LOC-003` and `CAP-001`

The package correctly treats `oploc:fika-xchange` and `oploc:cpux` as separate durable identities, CPUX as producer, `cpux@fikacatering.com` as an intake reference, and hosting as non-canonical test configuration pending a separate governed relationship contract.

## 3.1 Authoritative transitional architecture

The CPU Calendar is a legacy intake mechanism, not the intended primary source for future FIKA OS Production. The target direction is:

1. upstream FIKA OS hospitality/ordering dashboards create governed Production JSON messages or records;
2. the CPU Dashboard ingests and presents that production demand;
3. the existing Calendar-led workflow remains operationally unchanged during transition; and
4. shadow reconciliation compares a legacy Calendar-derived observation with the new dashboard-originated governed Production representation.

Four boundaries must remain separate:

| Boundary | Purpose | Current status |
|---|---|---|
| Canonical dashboard-to-CPU contract | Governed Production demand passed from upstream FIKA OS applications | Undefined; Stage 7 governance prerequisite |
| CPU Dashboard ingestion interface | Accepts and presents the governed production demand without redefining it | Undefined; later implementation boundary |
| Legacy Calendar snapshot adapter | Produces minimised transitional observations for compatibility, replay and comparison | Provider access not authorised; `fika.cpu-intake-snapshot` is its candidate observation contract only |
| Shadow reconciliation | Compares the legacy observation with the new governed representation and reports differences | Current implementation accepts only the legacy-shaped synthetic observation; dual-representation comparison is not implemented |

`fika.cpu-intake-snapshot` 1.0.0 must not be described or reused as the canonical dashboard-to-CPU contract. Its Calendar source type, intake reference, recurrence/update evidence and Europe/London assumptions are transitional adapter constraints, not Production-domain rules.

## 4. Independent verification environment

| Item | Value |
|---|---|
| Operating environment | Windows, local filesystem only |
| Node.js | `v24.14.1` |
| npm | `11.18.0` |
| Dependency install | Package-local `npm ci --ignore-scripts --no-audit --no-fund` |
| Normal verification directory | `C:\Users\derek\AppData\Local\Temp\fika-stage7-review-09d9251ebea846d99f8f06f408f044b7` |
| Network/provider access | None required or performed |

Before and after repository status snapshots were byte-compared. Runtime verification changed no tracked or untracked source path outside already ignored package-local dependencies and disposable output.

## 5. Requirement traceability matrix

Evidence references below identify the exact implementation commit, file and relevant lines.

| Requirement | Classification | Exact evidence and assessment |
|---|---|---|
| Authorised scope | Satisfied | `package.json:1-20`, `README.md:1-93`; one package at the authorised path |
| Explicit non-outcomes | Satisfied | `README.md:77-93`; canonical persistence, providers, hosting and deployment explicitly unsupported |
| Offline and synthetic-only boundary | Satisfied | Snapshot schema lines 22-29 and config schema lines 9-15 use constants; runtime network scan found no provider/network capability |
| Source neutrality for transitional reconciliation | Partially satisfied | Reconciliation internals preserve generic identity/evidence categories, but snapshot schema lines 24-29 hardcode a Calendar-shaped source and the tool accepts only that one representation. Appropriate for the first legacy-observation seam, not the final two-source reconciler |
| Canonical dashboard-to-CPU distinction | Partially satisfied | README and schema say non-canonical, but neither defines the future governed JSON contract or dual-input comparison. Correctly absent from the first-code implementation, now a remaining Stage 7 governance prerequisite |
| Snapshot identity and version | Satisfied | Snapshot schema lines 10-18 requires `fika.cpu-intake-snapshot` `1.0.0` |
| Strict validation | Satisfied | `src/validation.js:1-22`; Ajv Draft 2020-12 strict mode and `additionalProperties: false` throughout both contracts |
| Provenance | Satisfied | Snapshot schema lines 56-67; evidence preserves it in `src/reconcile.js:106-112` |
| Bounded scope | Satisfied | Snapshot schema lines 31-42; semantic window ordering in `src/snapshot.js:4-10` |
| Explicit as-of time | Satisfied | CLI requires `--as-of` at lines 23-25 and equality is enforced at lines 57-64 and `src/reconcile.js:20-22` |
| Sanitisation evidence | Satisfied | Snapshot schema lines 43-55; synthetic fixture records method/version/exclusions |
| Observation integrity | Satisfied | Canonical observation digest checked at `src/snapshot.js:17-20` |
| Producing OPLOC identity | Satisfied | Schema constant `oploc:cpux` at line 36; semantic cross-check at `src/snapshot.js:11-13` |
| Intake-reference distinction | Satisfied | Schema constant at lines 24-29 and evidence field at `src/reconcile.js:99`; no identity use |
| Non-canonical hosting configuration | Satisfied | Config lines 4-15 and config schema lines 11-25 prohibit canonical persistence/relationship status |
| Source observation identity | Satisfied | Required by snapshot schema and emitted separately at `src/reconcile.js:70` |
| Source record identity | Satisfied | Required at snapshot schema lines 90-101 and emitted separately at `src/reconcile.js:71` |
| Shadow order identity | Satisfied | Content-derived independently at `src/reconcile.js:51-54` |
| Shadow line identity | Satisfied | Content-derived independently at `src/reconcile.js:56-64` |
| Mapping-run identity | Satisfied | `src/reconcile.js:28-33` |
| Reconciliation-run identity | Satisfied | `src/reconcile.js:34` |
| Discrepancy identity | Satisfied | `src/reconcile.js:37-48` |
| Evidence-export identity | Satisfied | `src/reconcile.js:123-126` |
| Warnings | Satisfied | Sorted and preserved at `src/reconcile.js:74,116` |
| Uncertainties | Satisfied | Sorted and preserved at `src/reconcile.js:75,117` |
| Exclusions | Satisfied | Explicit unresolved semantics appended at `src/reconcile.js:3-14,76,118` |
| Duplicate handling | Satisfied | Duplicate source records create stable discrepancies; test lines 76-84 |
| Partial input | Satisfied | Partial observations remain source observations at `src/reconcile.js:65-74`; test lines 60-74 |
| Cancellation | Satisfied | Wednesday fixture records explicit cancellation without deriving operational action |
| Disappearance without confirmed cancellation | Satisfied | Friday fixture and test lines 64-67 retain the uncertainty |
| Missing units | Satisfied | Thursday/Friday fixtures retain null units and exclusions; no default applied |
| Missing stable line references | Satisfied | `src/reconcile.js:56-64` emits unresolved mapping outcome rather than inventing source identity |
| Withheld dietary detail | Satisfied | Tuesday fixture records `present-withheld`; evidence carries presence only |
| Ambiguous timing | Satisfied | Schema permits explicit `ambiguous`; fixtures retain it without required-ready inference |
| Incorrect producing OPLOC | Satisfied | Schema and semantic checks reject it; test lines 46-58 |
| Deterministic reruns | Satisfied | Test lines 86-94 and independent replay produced identical ID and bytes |
| Fail-closed recovery | Partially satisfied | Schema-invalid JSON values return exit 2 and quarantine; malformed JSON exits 1 before quarantine because `readJson` at `src/io.js:5-7` throws before CLI rejection handling |
| Prior-evidence preservation | Satisfied | `writeFile` uses `wx` and compares identical existing bytes at `src/io.js:26-40`; test lines 107-120 and independent replay passed |
| Output confinement | Not satisfied | `src/io.js:16-23` checks lexical paths only. A pre-existing directory junction redirected the write outside the supplied directory while the CLI exited 0 |
| No external effects | Satisfied for ordinary execution | Only local reads/writes exist; no provider/network/database dependency. The junction defect remains a filesystem-boundary violation |
| Documentation | Satisfied | README documents purpose, commands, status, safety and unsupported capabilities |
| Test coverage | Partially satisfied | Eight tests cover core behaviour, but no junction/symlink, malformed-JSON quarantine, input-size or observation-count boundary test exists |
| Coexistence with existing CPU workflow | Satisfied | No import, call, write or configuration link to the existing CPU application |

## 6. Implementation findings

The business and evidence boundaries are strong. The tool validates a transitional legacy-source observation contract rather than pretending to create Pack 6 records. It preserves provenance and uncertainty, separates all required identities, produces stable content-derived identifiers and never adds a universal match score. Valid and expected-invalid fixtures behave as declared.

The implementation is not source-neutral at its contract boundary: `calendar-intake-synthetic-snapshot` and `cpux@fikacatering.com` are schema constants, and reconciliation consumes only one snapshot rather than a legacy observation plus dashboard-originated governed JSON. This does not violate the bounded first-code task, which explicitly authorised that Calendar-shaped synthetic snapshot. It does mean the package cannot be promoted as the final reconciliation architecture or dashboard-to-CPU interface. Documentation is sufficiently explicit that the output is non-canonical, but future governance must strengthen the architectural distinction before expansion.

The CLI path is: parse explicit arguments → read snapshot/config → strict schema validation → semantic identity/window/integrity validation → accepted validation evidence or quarantine. Reconciliation occurs only after acceptance and produces canonical-key-ordered, non-canonical evidence. Source objects are not mutated; the test at `test/cpu-shadow-reconciliation.test.js:86-94` independently clones and compares them.

## 7. Security and safety findings

### Blocking defect S7-I1-DEF-001 — junction/symlink output escape

- **File/behaviour:** `src/io.js:16-30`; containment uses `resolve`/`relative`, then creates/writes through the unchecked filesystem path.
- **Reproduction:** create the declared output directory, make its `reconciliation` child a Windows junction to a sibling directory, then run the valid reconciliation command.
- **Observed result:** exit `0`; one evidence file was created in the junction target outside the explicitly supplied output directory.
- **Violated requirement:** writes must remain beneath the explicitly supplied absolute output directory.
- **Severity:** High within the stated safety contract, despite the current Derek-only local threat model.
- **Blocking impact:** Blocks offline-seam technical completion.
- **Smallest correction:** reject an output root or any existing/created ancestor that is a symbolic link, junction or other reparse point; resolve and verify real paths immediately before file creation; open/create safely without following redirections; add Windows junction and portable symlink tests.

### Blocking defect S7-I1-DEF-002 — malformed JSON has no quarantine evidence

- **File/behaviour:** `src/io.js:5-7` throws during `JSON.parse`; `src/cli.js:36-37` reads before its validation/quarantine path.
- **Observed result:** malformed JSON exited `1` with `Unexpected end of JSON input`; no output/quarantine directory was created.
- **Violated requirement:** rejected input must produce quarantine evidence while failing closed.
- **Severity:** Medium.
- **Blocking impact:** Blocks complete satisfaction of the authorised rejection/evidence contract.
- **Smallest correction:** catch bounded input/read/parse errors after validating the output/config arguments, emit redacted deterministic quarantine evidence that does not require parsing the payload, and test malformed JSON plus unreadable input.

### Risk S7-I1-RISK-003 — unbounded local resource consumption

The implementation reads the whole file, recursively canonicalises it and accepts unbounded arrays/strings in several schema locations. A very large or deeply nested file could exhaust memory or stack before useful quarantine evidence. This is not provider exposure and does not broaden business scope, but the corrective task should introduce evidence-based package-local input-byte, observation-count, item-count and depth limits, with fail-closed tests. Exact limits are an engineering choice for this offline CLI and must be documented rather than presented as business policy.

### Other safety findings

- Lexical `..` traversal and relative output paths are rejected.
- `writeFile(..., { flag: 'wx' })` prevents ordinary replacement races and different bytes cannot overwrite an existing evidence filename.
- A later schema-invalid run preserved the prior successful evidence byte-for-byte.
- There are no network, provider, Google, Firebase, OAuth, service-account, database, hosting, credential or operational-write capabilities.
- `node_modules/` and generated `evidence/` are ignored; the outer repository was not converted into an npm workspace.

## 8. Determinism and recovery evidence

| Check | Result |
|---|---|
| Test suite | 8 passed, 0 failed |
| Valid validation | Exit 0, accepted |
| `missing-provenance.json` | Exit 2, quarantined |
| `unknown-field.json` | Exit 2, quarantined |
| First reconciliation | Exit 0, `created` |
| Second identical reconciliation | Exit 0, `preserved-identical` |
| Evidence export ID, both runs | `evidence-export:1efa70495fa5d0951ae8f1a2` |
| Evidence SHA-256, both runs | `687E2ECA76990CCC693E9B84A7C081FFD05B854CFACFFD1BF6FE5E5F10C581BC` |
| SHA-256 after later invalid attempt | Same value |
| Source/repository status after verification | Unchanged |

Canonical JSON recursively sorts object keys while preserving array order. Evidence arrays that are set-like are explicitly sorted before export. Derived IDs use SHA-256 over canonical JSON without randomness. For the supported fixtures, identity and bytes are unambiguous and reproducible.

## 9. Known limitations and correctly deferred scope

Correctly deferred and not defects:

- sanitised or live Calendar extraction;
- canonical dashboard-to-CPU Production JSON contract and versioning;
- CPU Dashboard ingestion interface;
- dual-representation comparison between dashboard-originated demand and legacy Calendar observation;
- provider/resource access and authentication;
- canonical Operational Location Relationship schema/persistence;
- canonical Booking or Production Order/Line construction;
- eligibility, lifecycle, required-ready time and Production ownership;
- unit conversion, yield, aggregation and routing;
- dietary/allergen allocation;
- amendment/cancellation operational action;
- notifications, hosting, deployment and Stage 8 rollout.

## 10. Offline-seam completion verdict

**NOT TECHNICALLY COMPLETE — OFFLINE SEAM**

The implementation substantially satisfies the business, validation, evidence, identity, determinism and coexistence requirements. It does not satisfy its explicit filesystem-confinement guarantee and does not quarantine malformed JSON. These are current-package defects, not future live-integration capabilities. No sanitised extraction or Stage 8 work is authorised.

## 11. Exact prerequisites for a transitional sanitised Calendar snapshot adapter

These prerequisites define a future bounded legacy-source adapter/observation task only. They do not make Calendar the primary Production source, define the canonical dashboard-to-CPU contract, or select or authorise provider technology. Governance of the dashboard-originated contract should precede provider extraction so the comparison target is known.

### Authority prerequisites

1. Identify the legal and organisational authority permitting read access to the selected CPU Calendar intake.
2. Name the source owner and accountable business approver by governed role/Assignment.
3. Create or confirm the required AUTHMOD Assignment and Authority Grant, with scope, actions, effective period and audit evidence.
4. Approve reviewer roles and access to sanitised evidence.
5. Approve an incident, suspension and support route before any provider contact.

### Governance prerequisites

1. Define and govern the canonical dashboard-to-CPU Production demand contract independently of `fika.cpu-intake-snapshot`.
2. Define contract ownership, source of truth, versioning and the CPU Dashboard ingestion boundary.
3. Define the source-neutral reconciliation boundary: legacy observation input, governed dashboard input, comparison dimensions and evidence output.
4. Approve the exact legacy-observation purpose and demonstrate that every retained Calendar field is necessary for comparison.
5. Confirm the future Operational Location Relationship contract is not required merely to extract evidence; the test assertion must remain non-canonical.
6. Approve retention/deletion rules for raw transit data, temporary files, sanitised snapshots, quarantine and logs.
7. Approve the sanitisation rules, prohibited-field list and evidence required to demonstrate compliance.
8. Record whether any sanitised snapshot may enter Git; default remains no without explicit approval.

### Provider and identity prerequisites

1. Establish the exact Calendar resource identity beyond `cpux@fikacatering.com`; the address alone is not identity or authority.
2. Evidence the relationship between that resource and CPUX without treating provider identity as canonical OPLOC identity.
3. Select the technical access model only after comparing least-privilege options and custodianship; do not preselect OAuth, service accounts or an API here.
4. Define stable source-record, recurring-series, occurrence, exception and observation identifiers and their provider-version evidence.

### Security prerequisites

1. Approve least-privilege read-only scope for the single resource and bounded dates.
2. Define authentication credential custody, rotation, revocation and non-export rules without storing credentials in either repository.
3. Define the extraction network boundary and prohibit provider writes, notifications and cross-resource discovery.
4. Define redacted logs, quarantine access, failure handling and an immediate stop/revocation route.
5. Prohibit raw persistence unless explicitly authorised; define secure temporary-file creation, permissions, cleanup verification and crash recovery.
6. Complete a dry-run security review proving that credentials, raw payloads and access-bearing links cannot enter logs, Git or offline evidence.

### Privacy and minimisation prerequisites

1. Decide treatment for descriptions/free text, contacts, organisers, attendees, employees, Clients, commercial details and dietary/allergen data.
2. Default each category to exclusion unless approved necessity and handling exist.
3. Define irreversible synthetic replacement or redaction rules, including attachment names, URLs, IDs and embedded metadata.
4. Define attachment handling; the minimum candidate is presence/type metadata only, with no bytes or document contents.
5. Define sanitisation evidence: method/version, executor, time, source scope, excluded categories, counts before/after, warnings and integrity digest.

### Source-semantic prerequisites

1. Approve exact Monday-to-Friday replay dates and event-selection boundaries.
2. Define inclusion by Calendar/resource, start/end overlap, timezone and `as-of` cut-off.
3. Define recurrence masters, occurrences, moved exceptions, cancellations and deletion/disappearance evidence without equating absence to cancellation.
4. Define all-day event handling and Europe/London daylight-saving transitions.
5. Define which provider update/version fields are authoritative enough for ordering evidence.
6. Define how attachments and event changes are represented without importing content.

### Technical prerequisites

1. Complete and commit the bounded correction for S7-I1-DEF-001, S7-I1-DEF-002 and the resource-boundary risk.
2. Specify a one-way legacy adapter output conforming exactly to `fika.cpu-intake-snapshot` 1.0.0 or return to governance if real provider evidence cannot fit without weakening the transitional contract.
3. Place integrity-digest creation after sanitisation and before the snapshot crosses into the offline tool.
4. Define raw-to-sanitised provenance without including provider secrets or prohibited content.
5. Guarantee that provider extraction and offline reconciliation remain separate processes and trust boundaries.
6. Keep the legacy adapter contract distinct from the governed dashboard-to-CPU contract and introduce no automatic coercion between them.

### Test and acceptance prerequisites

1. Use synthetic provider-shaped tests before any access attempt.
2. Test recurrence, exceptions, cancellation, disappearance, all-day, DST, partial response, pagination, retry and provider-version cases without contacting production.
3. Prove read-only scope, redaction, deterministic sanitisation, integrity verification, temporary-file cleanup and fail-closed quarantine.
4. Obtain authority/security approval of dry-run evidence before code contacts Google.
5. Obtain reviewer approval of one sanitised snapshot's minimisation and provenance before it enters the offline reconciliation tool.

### Explicit Derek decisions still required

- Accountable owner and approval route for the dashboard-to-CPU Production contract.
- Whether the dashboard-originated message represents a Production Order directly or a governed request that the Production domain transforms into one; this must follow Pack 6 and ADR-004 rather than application convenience.
- Minimum fields, versioning and delivery semantics required by the CPU Dashboard ingestion interface.
- Authoritative source and amendment/cancellation behaviour for dashboard-originated Production demand.
- Accountable source owner/approver and authorised reviewers.
- Exact provider resource identity and bounded replay dates.
- Permitted source fields and prohibited/free-text categories.
- Attachment, dietary/allergen, commercial, employee and Client-data treatment.
- Retention/deletion periods and whether any sanitised evidence may be retained in Git.
- Preferred access-model decision criteria and credential custodian after security options are evidenced.
- Incident/support route and authority to suspend access.

### Capabilities that remain outside the future extraction task

- provider writes or Calendar changes;
- cross-Calendar discovery;
- canonical Booking, Production, OPLOC or relationship persistence;
- OPLOC administration;
- operational notifications or workflow changes;
- Production decisions, matching defaults or universal scores;
- hosting, Firebase, databases, deployment, cutover or rollout.

## 12. Remaining Stage 7 gaps

- Correct the two blocking offline defects and add resource-boundary tests.
- Rerun this technical completion gate after the correction commit.
- Govern the canonical dashboard-to-CPU Production contract, CPU Dashboard ingestion boundary and source-neutral comparison boundary.
- Only then prepare and approve the transitional Calendar-adapter authority package described above.
- Preserve all Production semantic gaps for later governed work.
- Complete Stage 7 product/technical acceptance only after the offline seam passes.
- Keep Stage 8 entry, operational validation and Production acceptance separate.

## 13. Next separately authorisable bounded task

Conduct one governance-only dashboard-to-CPU contract boundary review. It must:

1. determine the authoritative Production meaning and owner of the dashboard-originated JSON;
2. decide whether the message is a canonical Production Order or a governed Production request transformed by the Production domain;
3. define the minimum contract identity/version, provenance, amendment/cancellation and idempotency expectations supported by existing BDRs and Pack 6;
4. define the CPU Dashboard ingestion interface without implementation or provider assumptions;
5. define a source-neutral reconciliation envelope that compares that governed representation with a separate legacy Calendar observation; and
6. keep `fika.cpu-intake-snapshot` explicitly transitional and non-canonical.

Do not implement the contract, modify Pack 6, access Calendar or alter the CPU Dashboard. After this governance task, separately authorise the package-only safety correction and only later consider a legacy Calendar adapter authority package.

## 14. Protected-scope confirmation

No live source was accessed. No Google, provider, credential, Calendar, Drive, Sheet, dashboard, production record or operational configuration was read or changed. No implementation source, schema, fixture or configuration was changed during this review. No outer-repository file was staged or committed.
