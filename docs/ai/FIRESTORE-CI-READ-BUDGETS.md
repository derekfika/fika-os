# Firestore CI operation budgets

These budgets measure attempted datastore operations in test fakes at the repository boundary. A document returned by a query counts as one read, a transaction document read counts as one read, and a write/delete counts as one mutation. Retries are counted separately so a retry cannot hide extra work. Queue candidate and predecessor reads are reported separately from the total.

The budgets protect already-remediated command and durable-outbox paths. They are not a target for the unremediated R5 AUTHMOD, R6 CPU projector, or R7 Delivered-In paths.

| Path | Scenario | Enforced budget | Must not scale with |
| --- | --- | --- | --- |
| Menu Planning working week | One entry command | 2 reads, 2 writes | total entries, history, publications |
| Menu Planning working week | T entry command | `1 + T` reads and writes (plus one read/write per affected day patch) | unrelated entries or days |
| Menu Planning working week | Stale CAS | bounded command reads, 0 writes | retry count or week size |
| Menu Planning week creation | Target already-exists check | 1 read; writes are `1 + days + entries` for a new snapshot | unrelated history/publications |
| Menu Planning catalogue lookup | K canonical IDs | K attempted document reads | total catalogue size |
| Menu Planning outbox | Modern claim page | 25 queue candidates and <=60 reads | delivered history |
| Menu Planning outbox | Legacy compatibility claim | <=105 reads (four 25-row pages plus bounded authority reads) | unbounded legacy history |
| CPU durable propagation | Command-scoped staging | one existence read and one write per new obligation | unrelated due/history records |
| CPU durable propagation | Global recovery | <=25 queue candidates per recovery page | delivered history |

Package materialisation is intentionally O(C), where C is the authoritative catalogue size. Its compressed-byte hash and package manifest must match the exact source revision/hash; package publication failure remains pending/failed, never current.

R5/R6/R7 are reported as baseline-only until their own remediation waves provide bounded contracts.
