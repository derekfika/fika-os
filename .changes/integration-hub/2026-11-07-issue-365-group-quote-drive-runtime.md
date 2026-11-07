# 2026-11-07 — Require a verified production runtime for group quote Drive access

The shared Drive token provider used by Hub group quote generation now denies staging and unverified hosted runtimes. This covers Drive credential acquisition. Existing quote response links remain a separate staging containment task.

Validation: isolated shared Drive provider tests passed. Hub app validation runs through exact-source CI. Deployment: none.
