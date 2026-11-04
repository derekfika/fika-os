# 2026-11-04 — Enforce overtime-only new labour charges

The authoritative Hub now rejects every new or changed labour line unless it uses the approved role's base normal TCTE with the locked 1.5× multiplier. Unchanged historical charges, including 1× Normal lines, remain readable and unchanged; existing quote snapshots stay immutable and later quotes create new revisions.

Validation: Full Hub suite 950 passed, 116 skipped, with one unrelated failure because the baseline address workflow fixture is missing. Hub typecheck passed. Focused contract tests passed. Emulator-backed group amendment test could not run because Firebase emulator download returned HTTP 403 under the configured network policy. Lint has existing repository-wide failures; the focused changed-file lint result is recorded in the PR.
Deployment: none. Staging booking and quote verification remain outstanding.
