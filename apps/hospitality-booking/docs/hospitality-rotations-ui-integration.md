# Hospitality Rotations UI integration boundary

Status: development-only dashboard foundation; production management UI is not enabled.

The preview at `/rotations-preview` is available only outside production. Its sample Dish Library, categories, groups, IDs, anchor date, seasonal versions and rules are isolated fixtures. Edits live only in React state for the current browser session. The screen does not save, activate, authorize or read production data.

## Provider handoff

Sol's Hospitality Rotations v1 handoff defines the shared source at `apps/shared/hospitality-rotations.ts` and Hub provider at `/api/hospitality-rotations`. That source currently lives in the separate active `hospitality-rotations-core` workspace and is not present on this dashboard branch's `origin/main` base (`c07caa822a6363803ce6331435ec1556673bcf1a`). This UI branch therefore does not copy the domain schema or import unmerged files.

The local server proxy in `app/api/hospitality-rotations/route.ts` uses the documented Hub path through `hubUserFetch`, forwards the current FIKA session cookie, and sets `private, no-store`. The Hub must enforce permissions for every request. The proxy does not grant access or validate business rules.

Documented provider operations are:

- `GET ?mode=access` for separate View, Manage and Publish capabilities.
- `GET ?mode=manage` for the company head and current draft.
- `GET ?date=YYYY-MM-DD` or `?mode=published` for the effective published revision.
- `GET ?mode=revision&revision=N` for published history.
- `POST` `save-draft` and `publish` commands using the shared strict Zod schema and company aggregate `expectedVersion`.

## Remaining integration work

- Wait for Sol's shared contract and Hub handler to be committed and available from the integration base, then import the shared types rather than recreating them in Hospitality.
- Add a server-rendered management entry gate that calls `mode=access`, requires the applicable capability, and fails closed on 401/503. No production page may render fixtures.
- Adapt `RotationRevision.configuration` into typed view models. Resolve Draft, Scheduled and Active labels from the draft and `head.activations`; never predict activation conflicts in the browser.
- Bind whole-configuration saves with stable request IDs and the current company `expectedVersion`; handle 409 by reload/review and 503 as unavailable. Publish the exact current draft through the Publish capability.
- Obtain a bounded, authorized canonical Dish Library search/read interface from its owner. The rotations provider accepts canonical dish IDs and recipe revisions but deliberately does not expose search.
- Obtain the canonical Hospitality Item picker/read interface. The provider requires unique canonical Item IDs and does not create Items.
- Align group archival with an explicit provider-supported versioned workflow. The provider v1 contract has no delete, withdrawal, reschedule or replacement command; preview archive behavior is local illustration only.
- Add production-route and adapter tests with Hub AUTHMOD behavior, then remove the development fixture entry point when the protected route is ready.

## View-model boundary

`lib/rotations-ui-types.ts` contains presentation-only shapes. It is not a second domain contract. The fixture configuration follows the handoff's categories, global calendar, groups, dish references, weeks and configurable rule ranges solely to exercise components until the shared module is available on the base branch.
