# 2026-11-26 — Trace and version Menu Studio catalogue reads

Hub exposes an authenticated version check for Studio's in-memory administrative catalogue. Catalogue changes advance the version in the same transaction, and OPLOC revisions and UK business-day changes also invalidate it. Studio can verify an unchanged snapshot with two Firestore document lookups plus normal authorization. A versioned full read checks the version on both sides of assembly. Catalogue, package and Studio access traces attribute reads and request timings through the existing FIKA data-source meter.

Validation: 63 focused catalogue, package and observatory tests, 15 isolated Firestore emulator tests, and Hub typecheck. Deployment: none.
