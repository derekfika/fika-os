# 2026-11-06 — Resolve shared Zod in Logistics App Hosting

Resolve shared production contract types against the Logistics app's installed Zod dependency in hosted app-only builds. The failed staging build `build-2026-11-06-001` compiled successfully before TypeScript could not resolve Zod from `packages/server-shared`.

Validation: app-only install, focused one-off routing checks (6 passed, 1 emulator-only skip), TypeScript, local Next.js output, and standalone asset verification passed. Hosted retry and exact-source CI pending.
Deployment: staging retry pending.
