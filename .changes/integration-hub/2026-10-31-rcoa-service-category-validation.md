# 2026-10-31 — Enforce RCoA service category visibility at booking acceptance

RCoA ingestion validates trusted item categories against the governed company/site service layout inside the booking transaction. Added, increased or changed lines and service/site changes use current rules on amendment; unchanged historical snapshots and reductions remain usable. Existing-only replay returns an existing canonical booking without writes and cannot create a missing booking. New validation adds two deterministic layout reads, plus bounded canonical item reads when changed amendment lines need them; no per-read audit writes or polling are introduced.

Validation: 11 focused boundary tests passed; isolated demo Firestore emulator atomic rejection/replay test passed; Hub typecheck passed. Full governed affected validation pending. No staging write-path UAT while #181 isolation is unverified.
Deployment: none.
