# 2026-10-30 — Edit permitted sites for restricted catalogue Items

Hospitality catalogue Items created for one site (for example the 11 One Angel Court wines) carry a governed
`allowedOplocIds` allowlist that availability edits correctly refuse to broaden, so RCoA could not be given the
existing wines. Add the governed `set-permitted-sites` command (manage permission, optimistic version, active-site
validation, reason, confirmed removal, revision and audit in one transaction) and an "Edit permitted sites" panel in
the Hospitality Catalogue, distinct from site availability. Prices, routing, minimums, configuration and Item identity
are untouched; the package is republished by the existing route. Adds a read-only planner script that verifies the
11 canonical wine IDs against live records and emits the exact commands. No data was changed.

Validation: see the PR. Deployment: none yet.
