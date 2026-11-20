# 2026-11-20 — Contain outbound effects for the Studio rehearsal

Keep the existing canonical order, fulfilment and CPU handoff records for the strictly scoped Studio rehearsal. Skip booking notifications and Logistics delivery and repair for its traceable records. An exact retry after Send to CPU requires the original quote-bound order.

Validation: 37 focused tests covering the isolated rehearsal, production, fulfilment and Logistics recovery. Hub typecheck passed.
Deployment: none.
