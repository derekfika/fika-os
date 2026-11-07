# 2026-11-07 — Add an optional read-only Hub site check

Keep the empty preview as the default. An explicitly enabled Target sites check uses the verified reviewer session and dedicated Beverage workload identity to read the approved OPLOC scope from Hub. Keep credentials server-side and mutation routes hidden.

Validation: All 44 app tests and six isolated Firestore emulator tests passed, along with typecheck, build and both dependency audits. Fictional transport and panel tests cover permission denial, credential forwarding, exact scope and unavailable responses.

Deployment: None. Hub provider review, runtime activation and verified grants remain gated.
