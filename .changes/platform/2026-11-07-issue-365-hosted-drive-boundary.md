# 2026-11-07 — Verify the hosted project before Drive access

The shared Drive provider denies staging, unknown and contradictory hosted identities before any OAuth credential read or token request. A claimed production runtime must await the Google metadata project check before Drive access. Concurrent requests share the verification, and explicit local OAuth remains available.

Validation: seven isolated shared Drive tests passed, including cold production verification and zero OAuth calls on denied paths. Deployment: none.
