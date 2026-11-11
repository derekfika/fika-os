# 2026-11-11 — Add the RCoA customer booking dashboard

Adds `/rcoa/bookings` using the shared Gallagher-style ledger UI and RCoA branding. RCoA receives an independent PIN/session/API namespace, read-only New booking and Support links, grouped All Day details, and exact server-side site/OPLOC scoped data. Sensitive identities, commercial values, PO references, and notes stay omitted pending owner visibility approval. Gallagher remains on its existing data provider and session namespace.

Validation: Hospitality typecheck passed; the full suite passed (447/447); production build passed; repository `fika validate` passed all 7 affected-app commands. Hospitality ESLint could not start because this app has no ESLint 9 `eslint.config.*`. Browser and staging authentication/data UAT remain pending. Style Guide compliance: PASS; existing RCoA portal brand colors and assets are used with shared FIKA semantic surfaces and focus tokens.
Deployment: none. Staging secret values and owner approval are not available in this change; customer credentials were not provisioned.
