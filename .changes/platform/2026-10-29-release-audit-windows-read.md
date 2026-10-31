# 2026-10-29 — Read release audit evidence safely on Windows

Use the read-only Cloud Logging API for Windows release recovery checks. Send filter syntax as JSON rather than through cmd.exe; preserve the shell safety guard. Exhaust pagination before proving an empty audit and fail closed for auth, network, malformed or incomplete responses. No cloud configuration or permissions change.

Validation: 12 focused audit/recovery tests and all 86 workflow tests passed; governed validation passed. Real staging Cloud Logging read succeeded and returned zero create events. Exact-source CI pending. Deployment: tooling only; no application source change.
