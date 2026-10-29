# Hospitality staging health

The Hospitality root intentionally returns HTTP 307 with the literal relative location `/workspace`. The staging release probe verifies that exact response, then requires HTTP 200 from the same backend's `/workspace`, with redirects disabled and caching disabled for both requests. External, query-bearing and unexpected redirects fail closed. Production probe behaviour is unchanged.

This HTTP check supplements the existing independent exact-source App Hosting READY/SUCCEEDED and single 100% traffic checks. It does not prove authenticated workflow UAT or permission assignments. Existing pending releases must still pass governed reconciliation with their original journal and rollback evidence; this change submits no rollout.
