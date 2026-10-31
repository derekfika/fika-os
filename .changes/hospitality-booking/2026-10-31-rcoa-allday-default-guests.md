# 2026-10-31 — Require RCoA All Day event default guests

RCoA All Day now reports and blocks a blank/zero event-level default guest count before progression. The default remains separate from each service’s own guest count and selected-item minimum; quantity rules are unchanged.

Validation: focused guest-count tests passed (30/30); Hospitality TypeScript typecheck passed; changelog check and `git diff --check` passed. Exact-source CI pending PR creation.
Deployment: none; no booking, catalogue, permission or operational data was changed.
