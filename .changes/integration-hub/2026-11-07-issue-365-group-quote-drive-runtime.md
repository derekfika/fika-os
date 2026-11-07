# 2026-11-07 — Require a verified production runtime for group quote Drive access

The shared Drive token provider used by Hub group quote generation denies staging and unverified hosted runtimes. The CPU Calendar quote endpoint now denies those runtimes before resolving a saved quote, preserving its existing session, site and revision checks for permitted runtimes. Stored quote links from other Hub and Hospitality endpoints remain separate containment work.

Validation: isolated shared Drive provider tests and eight Calendar quote access, history and route tests passed. Hub typecheck and production build passed. Deployment: none.
