# 2026-11-03 — Link CPUX events to the canonical CPU order

Calendar events now include the friendly CPU application URL with the canonical Production Order ID and service date. CPU opens that order through its existing authenticated detail flow; the link does not include quote files, attachments or customer data. This closes the event-access gap while preserving the legacy scanner's skip behavior.

Validation: focused publisher and deep-link regressions, CPU typecheck, full tests and build pending final integration. Deployment: none.
