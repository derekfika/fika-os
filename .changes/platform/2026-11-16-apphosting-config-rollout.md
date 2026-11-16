# 2026-11-16 — Governed App Hosting configuration-only rollout

Adds a narrowly scoped production Hub path for applying or clearing the RCoA Calendar catch-up approval-hash override without changing source. The dry-run binds the exact value, serving revision, backend ETag and current override set into an approval hash; execution requires that hash, an authenticated repository writer, merged-source CI, a durable release intent, and the existing App Hosting rollout/source/traffic/smoke verification. Only the single approved Hub variable accepts a 64-character SHA-256 value. Repeated unchanged values are a no-op. No Calendar or Scheduler operations are part of this path.

Validation: workflow release execution and App Hosting release tests; workflow CLI parsing regression; full workflow validation pending.
Deployment: none. Tooling change only; no runtime configuration was applied.
