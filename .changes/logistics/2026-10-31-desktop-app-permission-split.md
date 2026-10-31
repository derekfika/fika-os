# 2026-10-31 — Separate desktop planner and van PIN authority

Authenticated desktop Logistics users with standard View can read both vans without individual vehicle grants; ordinary planner writes require standard Manage. Existing explicit vehicle grants continue to scope restricted users, and mobile PIN sessions remain limited to one van and the driver-action allowlist. Maintenance/repair actions continue to require their separate authorities. IndexedDB cache scope now includes desktop capabilities and session kind.

Validation: authority 55/55, access regression 93/93, mobile/read-path focused 26/26, Logistics typecheck and production build passed. Local API integration suite could not start because its isolated Firestore emulator at 127.0.0.1:8085 was unavailable; hosted exact-source CI remains required.
Deployment: none; staging and device UAT not verified.
