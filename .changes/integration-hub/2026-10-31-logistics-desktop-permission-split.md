# 2026-10-31 — Logistics desktop admission permissions

Hub Logistics admission now evaluates the active standard application View and Manage grants and sends those capabilities separately from explicit vehicle View grants. Invalid vehicle context and unavailable AUTHMOD policy still fail closed; existing maintenance grants remain separate. The admission evaluation reuses one request context and adds no new Firestore collection scan or audit write.

Validation: isolated Hub admission/evaluator tests 18/18, Logistics AUTHMOD regression 37/37, Hub typecheck and production build passed. Logistics integration suite could not start locally because its Firestore emulator at 127.0.0.1:8085 was unavailable; hosted exact-source CI remains required.
Deployment: none; staging and operational UAT not verified.
