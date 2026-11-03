# 2026-11-03 — Preserve the Ad-Hoc first-release baseline target

The first-production bootstrap now writes the canonical Ad-Hoc backend ID into the release record. Validation also accepts the exact resource path produced by the already recorded empty baseline, while rejecting any other backend. This keeps the existing append-only baseline usable without rewriting release history.

Validation: `node --test tools/workflow/policy.test.mjs tools/workflow/releases.test.mjs` passed (35/35). Focused tests passed (35/35); exact-source CI pending.
Deployment: none.
