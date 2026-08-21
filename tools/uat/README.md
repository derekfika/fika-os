# Golden Week integration harness

Golden Week covers 24–28 August 2026 and is defined in
[`golden-week.json`](./golden-week.json). The local seeder is idempotent and
uses the existing domain APIs; the Playwright project checks exact owned source
and Logistics counts, duplicate protection, CPU scopes, and the Logistics UI.

Prerequisites: local Auth/Firestore emulators plus Hub, Hospitality, Menu
Planning, Delivered-In, CPU and Logistics on ports 3200, 3300, 3500, 3800,
3400 and 3900. The seeder refuses non-local URLs and production Firebase.

From the repository root:

```text
npm run golden-week:cleanup
npm run golden-week:seed
npm run golden-week:e2e
npm run golden-week:verify
```

Cleanup deletes only manifest-owned Logistics documents. Source bookings,
publications and Grab & Go orders are retained because those domains require
their supported cancellation/withdrawal workflows.
