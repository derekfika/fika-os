# 2026-11-23 — CPU Gastro Label loading and font fit

The Menu Planning materializer stamps `origin: menu_planning` and publication lineage but leaves the optional `productionCategory` unset. Classify those rows through the same Run Sheet service rule and inherit a missing optional line workstream only from that canonical source. Keep publication lineage, withdrawn-order and explicit conflicting-route checks. Add measured font fitting and per-dish print-session overrides while preserving Trial C geometry and the blank SITE line.

Validation: Gastro Label tests 8/8, CPU print suite 19/19, typecheck and production build passed. Full CPU unit suite did not complete: three unrelated Menu Planning handoff tests stalled for over 3 minutes each before the run was stopped. Exact-source CI pending.
Deployment: not deployed.
