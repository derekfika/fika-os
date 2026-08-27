# Menu Planning hosted persistence — Phase 2A

Phase 2A prepares the hosted repository and does not activate it or write any
operational data. Local development continues to use SQLite. Hosted reads and
writes remain explicitly unavailable until the Phase 2B migration and async
application cutover are approved.

The Firestore adapter is server-only and is exported through the
`operational-store` boundary. It uses `@google-cloud/firestore` application
default credentials; Menu Planning does not depend on `firebase-admin` and
does not call AUTHMOD or Integration Hub server implementation directly.

Collections:

- `fikaMenuPlanningWeeks/{weekId}/days/{dayId}/entries/{entryId}`
- `fikaMenuPlanningPublications/{publicationId}/days/{publicationDayId}`
- `fikaMenuPlanningEvents/{eventId}`
- `fikaMenuPlanningOutbox/{eventId}`
- `fikaMenuPlanningArchiveMetadata/{archiveId}`
- `fikaMenuPlanningCatalogue/{canonicalId}`

Week/day/entry identity is preserved from SQLite. Publication days are
immutable. Events and outbox records use the same deterministic event ID.
Writes use Firestore transactions and expected week versions; differing
immutable publication data or rewinding delivered events are rejected.

The catalogue keeps the 344 local canonical IDs and five saved sandwiches as
`kind: "dish"` and `kind: "sandwich"` records respectively. Both remain
`unreconciled` until an explicit human mapping to a central canonical entity.
No semantic auto-merge is permitted.

The rules in `firestore.rules` deny browser access to all Menu Planning
collections. Authorization remains server-side and AUTHMOD remains
authoritative through the existing Integration Hub HTTP boundary. Cached
`allowedOplocIds` are never authorization authority.

`npm run migration:dry-run` only accepts the authoritative
`local-data/menu-planning/operational.sqlite` fingerprint recorded in Phase 1
and refuses `--write`.
