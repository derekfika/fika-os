# Hospitality Menu Studio integration handover

Source reviewed on 25 November 2026 against `246e876ec32e2e22844d939e2b7f71fbd376a9ea`. PRs #677–#679 are included. The existing MNK rehearsal is the only implemented customer entry for Studio dishes. Hosted multi-site acceptance remains outstanding under [#676](https://github.com/derekfika/fika-os/issues/676).

| Boundary | Contract to retain when replacing the Studio interface |
| --- | --- |
| Authoring | [Studio HTTP handlers](../../hospitality-menu-studio/lib/http.ts) expose versioned draft writes and restore, review and publication operations. [Content schemas](../../shared/hospitality-menu-studio-content.ts) retain dish identity, revision, customer and kitchen copy, structured assortments and stable section-to-Item mappings. Each rotation has a Monday anchor and six independently populated weeks. |
| Food safety | [CPU dish review](../../cpu-production/lib/studio-dish-review.ts) owns review subjects and dual signatures. Studio and Hub validate exact dish revision, release and matrix hash. Hub checks the release and signature events again when serving or accepting choices. The portal receives customer descriptions. |
| Publication and activation | [Studio publication](../../hospitality-menu-studio/lib/publication.ts) freezes menu and dish revisions. [Hub registration and activation](../lib/hospitality-studio-publications.ts) verify the package, catalogue and signing evidence. A versioned site schedule resolves one effective customer revision for the event date and rejects conflicting activations. Staff collection visibility remains distinct. |
| Sales catalogue | Studio's [catalogue gateway](../../hospitality-menu-studio/lib/catalogue-gateway.ts) forwards Item, bulk, archive/restore, pricing, override, routing, provider-mapping and service/category commands to Hub under its existing authority. Hub resolves site, service, availability, selling unit, VAT, prices and minimums. [Catalogue details](../../hospitality-menu-studio/docs/catalogue-integration.md) cover supported command shapes and access. |
| Booking | The [Hub portal read](../app/api/hospitality-menu/portal/route.ts) resolves date-specific choices. [Hub booking acceptance](../lib/hospitality-studio-booking.ts) verifies selections, publication hash, price, per-variety minimum and line totals and stores the private kitchen evidence in the same transaction. Replacing a dish, date or quantity on a frozen booking requires an explicit amendment workflow. The current pilot rejects those amendments. |
| Quotation and kitchen | The private specification binds to an immutable quote revision and the booking line identity. [Send to CPU](../lib/production-domain.ts) uses the accepted evidence and governed production routing to create the canonical order and linked fulfilment requirement. [CPU kitchen projection](../../cpu-production/lib/studio-kitchen-spec.ts) supplies quantities and instructions to the run sheet. |

## Frontend coupling

The current `studio.tsx`, `studio-menus.tsx`, `rotation-workspace.tsx`, dish editors and catalogue views are presentation components in [Studio components](../../hospitality-menu-studio/components). A replacement must preserve the draft hook’s version/conflict semantics, stable IDs during reordering, the distinction between unsaved preview and published content, and each command’s separate actor and permission checks. The server-owned content schemas, immutable publication format, Hub catalogue gateway and CPU review subject can support a different authoring interface.

## Hosted acceptance

Within the MNK rehearsal, the Hub and Hospitality pilot configurations must agree on site, dates and source booking identity. The Hub pins the menu and authorised actor and requires outbound email disabled. Acceptance also requires a current effective Offering, signed publication and explicit activation. The [rehearsal manifest](studio-mnk-rehearsal-manifest.md) identifies the hosted evidence to collect. Other sites need their actual canonical site binding, service layout and booking route, including the separate RCoA group workflow.

On 25 November 2026 the repository serving check verified a single 100% ready build from the FIKA repository on each of these staging backends in `fika-os-dev`. The flag observations come from those builds' effective configuration.

| App | Serving source | Rollout | Effective staging setting |
| --- | --- | --- | --- |
| Studio | `36a9c3fce83501123e6ce9d6b6633ffee4721208` | `build-2026-11-23-002` | CPU review and publication flags absent |
| Hub | `5e436da8d5666ad2f9794b1655be6352cec3d62d` | `build-2026-11-24-001` | Pilot and booking flags absent, Hospitality email delivery false |
| Hospitality | `b74f0c372fda350bfcf8764621fd94ce25a1197a` | `build-2026-11-23-003` | Portal pilot flag absent |
| CPU | `5e436da8d5666ad2f9794b1655be6352cec3d62d` | `build-2026-11-24-001` | Studio dish review flag absent |

The CPU backend now serves the revision containing the review endpoint. Its disabled setting still blocks a hosted Studio dish review. Recheck effective settings, genuine signing and activation evidence, exact site/date eligibility and side-effect isolation before the rehearsal.
