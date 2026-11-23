# 2026-11-23 — Reuse CPU workstream contract for Ad Hoc scope

The shared Ad Hoc request contract now types its optional production scope against the existing CPU production workstream vocabulary; no new routing classification was introduced.

Validation: Ad Hoc, CPU, and Hub typechecks and production builds passed. Scope handoff and CPU routing regression coverage passed in focused tests and emulator integration.
Deployment: the shared contract shipped with Ad Hoc staging `build-2026-11-23-001`, CPU staging `build-2026-11-23-001`, and Hub staging `build-2026-11-23-004`, all at source `a2e123b4af1629828e4046004b74ae423161d41d` and 100% traffic. No production deployment. Authenticated browser UAT remains blocked by a mismatched desktop capture surface.
