# 2026-11-05 Validate later intents during canonical marker recovery

Allow valid mapped PENDING intent records later in the same release-ledger history to be validated as intents while requiring terminal records to satisfy the governed release-record schema. This avoids rejecting completed historical release chains while preserving fail-closed target and source checks.

Validation: focused regression pending; exact-source CI pending.
Deployment: no deployment or marker recovery performed.
