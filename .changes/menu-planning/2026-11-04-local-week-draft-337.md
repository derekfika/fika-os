# 2026-11-04 — Local week drafts and unrestricted dish discovery (#337)

Week Planner edits use a recoverable per-identity/environment/week browser draft and explicit version-checked Save Week. Atomic diff saves preserve stable entry IDs, portions, allocations, server-owned allergen review and audit evidence; request receipts make retries idempotent. Conflicts retain drafts for explicit three-way review. Publication and downstream handoff remain separate.

The picker searches all canonical dishes and aliases, including uncategorised records. Recommendations rank rather than exclude. Optional contextual classification adds a registry menu-use tag without replacing primary category or prior uses. Canonical dish creation/classification remain explicit immediate catalogue actions.

Validation: nine isolated browser scenarios passed (20 edits without a week mutation; explicit/repeated saves; refresh recovery; navigation protection; two-editor conflicts; interrupted-response idempotent retry; edits during save; existing/uncategorised/alias search; contextual classification; Enter creation). A 504-dish/110-entry browser benchmark at 4x CPU throttle measured 16.8 ms median / 156.2 ms maximum input-to-paint, with no typing-time requests. Menu typecheck and initial production build passed. The full suite passed 496 tests with two skips before the final edge cases; the final local run passed 499 assertions with two skips but failed existing Windows temporary-directory cleanup in publication-async.test.ts. Exact-source CI remains a required release gate. Additional UAT stopped on the owner's urgent release instruction.

Deployment: Menu-only governed staging verification and production promotion authorised by the owner; actual sources, rollout and rollback lineage are recorded in the append-only release ledgers. No migrations, production operational test writes or unrelated app releases are included. Canonical cross-app layout #334 remains separate.

Style Guide compliance: PASS. Existing semantic controls/surfaces, labelled statuses, keyboard combobox and managed dialogs; desktop, tablet and mobile rendering inspected. No new palette, typography or tactile dimensions.

Cost/audit: one bounded week transaction per explicit save, existing atomic audit plus request receipt, no per-search/per-edit writes or recurring jobs. An explicitly chosen global classification uses an additive tag and canonical catalogue revision/hash publication; its deliberate catalogue mutation scan follows the existing catalogue source-hash model.
