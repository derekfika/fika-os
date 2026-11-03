# 2026-11-03 — Register Ad-Hoc in governed releases

The canonical release registry now maps Ad-Hoc to its existing staging and production App Hosting backends so affected-app validation and release targeting use the established `adhoc` identifier.

Validation: `node --test tools/workflow/policy.test.mjs` passed (15/15). Full workflow validation pending.
Deployment: none.
