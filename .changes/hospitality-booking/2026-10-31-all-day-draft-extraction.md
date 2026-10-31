# 2026-10-31 — Site-parameterised All Day draft foundation

Add an optional canonical site identity to the pure All Day draft and a factory that validates it. The existing RCoA path does not add site identity to outbound booking payloads.

Validation: Focused RCoA All Day tests 23/23; full Hospitality suite 421/421; typecheck and production build passed. Workspace scope and changelog checks passed. ESLint could not run because this app has no ESLint config.
Deployment: None; no booking, staging, or production data changes.
