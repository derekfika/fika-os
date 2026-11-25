# 2026-11-25 — RCoA Studio dish allocation boundary

The shared Hub allocation validator now verifies grouped quantity controls against the published dish set: groups must partition unique dish IDs, selected counts must meet the per-dish minimum, and counts must sum to the booked line quantity. Checkbox and grouped single-choice controls remain unsupported without an authoritative allocation contract.

Validation: shared allocation regression tests and Hospitality consumer tests. Deployment: none; staging publication and RCoA booking gates remain separate.
