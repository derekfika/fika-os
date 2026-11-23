# 2026-11-23 — Ad-Hoc checker wire contract

Added dependency-free shared types for current checker status and the Hub projection. Updated the Ad-Hoc Hub contract and scoped agent guide to document the CPU-owned review boundary and permissioned PDF proxy.

Validation: shared types compile in the CPU, Hub, and Ad-Hoc typechecks; `npm run fika -- changelog check --base origin/main` passed with all three app fragments and this platform fragment present. `git diff --check` passed.
Deployment: none.
