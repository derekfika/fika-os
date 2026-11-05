# 2026-11-05 — Issue #381 allergen matrix visibility

Bound the allergen matrix to a horizontally scrollable viewport and constrain the Dish column so long and unbroken names wrap without displacing allergen or review controls. No allergen review, persistence, or publication semantics changed.

Validation: focused layout contract test, Menu Planning tests, typecheck, build, and governed validation (recorded in the PR). Staging UAT was not run because staging isolation issue #181 remains a required gate.
Deployment: none.
