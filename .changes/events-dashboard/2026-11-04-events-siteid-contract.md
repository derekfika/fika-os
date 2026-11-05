# 2026-11-04 — Preserve unresolved Events site references

Corrected the domain test to reflect the Hub-owned reference boundary. Legacy `siteId` values remain stored; unknown values are surfaced as unresolved for review without name remapping.

Validation: focused tests 11/11; Events Dashboard suite 22/22; typecheck passed; lint passed with four pre-existing warnings; production build passed; governed validation passed.
Deployment: none.
