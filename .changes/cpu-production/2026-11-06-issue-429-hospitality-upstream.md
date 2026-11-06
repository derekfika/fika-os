# 2026-11-06 — Guard CPU Hospitality PDF upload destinations

CPU validates the Hospitality origin before rendering a release PDF or forwarding it with session or service credentials. Staging accepts the configured Hospitality staging domain, production accepts the governed Hospitality origins, and both upload paths reject redirects. Local development retains its loopback default.

Validation: 12 focused tests passed. Full CPU suite passed with 610 passed and four skipped. CPU typecheck and production build passed. Deployment: none.
