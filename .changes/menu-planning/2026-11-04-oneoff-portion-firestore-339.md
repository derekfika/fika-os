# 2026-11-04 — One-off portion allocation Firestore save recovery

Destination normalization now omits the optional destinationId property for true one-off allocations instead of introducing undefined before a Firestore write. Existing governed ID/alias mapping, destination labels/addresses, source labels, quantities, optimistic concurrency and publication behavior are preserved. The common fix covers batch portion saves, single-entry updates and snapshot normalization.

Validation: focused normalization regression passed; Menu unit suite 500 passed, 3 optional tests skipped; typecheck and production build passed. An isolated demo-project Firestore emulator exercised the application batch-save and single-entry-update paths, read-back of mixed governed/one-off allocations at index 2, multiple rows, zero quantities and stale duplicate rejection (409).

Deployment: none at implementation time; staging verification and production release readiness are recorded in the task/PR. No live menu data was changed.
