# 2026-11-04 — Agency / overtime-only labour calculator

Removed the Normal rate choice from the shared standalone and grouped-service labour calculator. New and edited lines use the approved TCTE overtime rate once; historical Normal lines are labelled and preserved until intentionally edited, with a warning before repricing. No site-specific calculator remains active.

Validation: Hospitality tests (433/433) and typecheck passed. Focused labour calculator tests passed (10/10). Build result and governance validation are recorded in the PR. Lint is blocked by the app's missing ESLint v9 flat config; explicit shared-config lint found pre-existing render-ref errors in this component.
Deployment: none. Staging booking screenshots and UAT remain outstanding.
