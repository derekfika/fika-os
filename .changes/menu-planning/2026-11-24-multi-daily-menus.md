# 2026-11-24 — Multiple daily and recurring menus

Added independently identified supplementary menu occurrences with reusable weekly recurrence templates, idempotent generation, occurrence skip/restore and an explicit end date. Each menu carries its own selected OPLOCs, service type, optional time and kitchen notes. Managers can amend one occurrence or explicitly apply changes to future generated occurrences. Draft saves and publication are limited to scheduled days; separate day identities preserve primary menu and production history. Portion planning filters to the supplementary menu’s sites, and exports identify each service.

Validation: focused Menu Planning tests (23 passed), typecheck and build. Earlier full suite: 584 passed, 4 skipped. Deployment: staging pending; production not deployed.
