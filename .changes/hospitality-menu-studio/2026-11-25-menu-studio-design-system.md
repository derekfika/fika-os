# 2026-11-25 — Establish the Menu Studio component foundation

Add a shared Menu Studio shell and semantic controls for catalogue-first navigation, responsive editor and secondary panes, statuses, panels, labelled fields and responsive actions. The foundation uses approved FIKA tokens and the existing FIKA wordmark. Navigation uses real links, preserves the caller's leave guard, supports keyboard dismissal and restores focus. Disabled actions can explain their visible blocker; fields expose hint and error relationships.

Validation: 89 Studio unit tests, TypeScript typecheck, production build and `git diff --check` passed. Authenticated visual/browser acceptance has not run; the shared primitives are not yet wired into a Studio screen.
Deployment: none.
