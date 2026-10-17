# Hospitality Catalogue admin (Integration Hub)

Permanent operator catalogue for Derek and Sam. Extends the canonical Item / Offering / Price architecture; there is no parallel catalogue model. Written 2026-10-17 against `origin/main` 1c959df.

## 1. Audit of what existed

| Concern | Where it lived before | Verdict |
| --- | --- | --- |
| Name, category, description, lifecycle | `Hospitality Menu Item` (`lib/schemas.ts`) | Sufficient. Reused. |
| Provider / source identity | `Item.providerMappings[]` (+ legacy id suffix on `hospitality-menu-item:<site>:<key>` ids) | Reused read-only (search + governance details). |
| Site/OPLOC availability | `Hospitality Menu Offering` (`hospitalityMenuItemId`, `oplocId`, optional `operationalAreaId`, `offeringMode`, `lifecycleState`) | Reused. One Offering per Item x OPLOC x area x mode. |
| Site display name / description | `Offering.configuration.displayName / description` | Reused as the existing "local wording" override. |
| Price | `Hospitality Menu Price` scoped to an **Offering only**, effective-dated, exactly-one-active rule in the portal read | Gap: no company default. Extended (below). Price stays authoritative. |
| Minimum quantity | `Offering.minimumQuantity` only | Gap: no company default. Extended: `Item.defaultMinimumQuantity`. |
| Production routing | `integrationHubHospitalityMenuProductionRouting/<sha(itemId)>` `{menuItemId, workstreams[], version}`; merge map `integrationHubHospitalityMenuItemMerges`; fail-closed states in `lib/hospitality-cpu-routing.ts` | Already Item-level. Reused unchanged. No site-level routing exists or was added. |
| Old operator UI | Connections -> "Hospitality Menu Items" (`HospitalityMenuProductionRoutingPanel`): grouped rows **by display name**, bulk "Review unclassified items" cards | Replaced. Name-based grouping removed. |
| Item create/archive | `POST /api/hospitality-menu/catalogue` -> `saveHospitalityMenuItem` (no duplicate check, no offerings, no routing) | Superseded for the UI by governed commands; endpoint left in place for existing callers. |
| Canonicalisation | `lib/hospitality-catalogue-canonicalisation.ts` (pure plan), `hospitality-catalogue-apply.ts` (per-group transaction), `scripts/hospitality-catalogue-canonicalisation.ts` | Unchanged. Prices/overrides survive because Prices hang off Offerings, which are repointed. |
| AUTHMOD | `lib/authmod.ts` `CanonicalPermissions`; catalogue routes used `requireActor(["integration-admin"])` + `canonical.edit` | New capability `hospitality.catalogue.manage`. |
| Audit | `integrationHubGovernanceAudit` (`action, entityReference, actorId, actorName, timestamp, reason`) + `integrationHubCanonicalRevisions` | Reused; events gain a `details` object (before/after, ids). |

## 2. Final data model (schema additions are minimal)

* `Item.defaultMinimumQuantity?: int >= 1` - company default minimum.
* `Price` is scoped to **exactly one** of `hospitalityMenuOfferingId` (site override) or `hospitalityMenuItemId` (company default). Enforced by `superRefine`; existing Offering-scoped Prices remain valid unchanged.
* New collection `integrationHubHospitalityCatalogueReviewDecisions/<groupId>` `{groupId, memberIds[], decision: merge|keep_separate|defer, survivorItemId?, decidedBy, decidedAt, version}`. `groupId` = first 16 hex of sha256 of the sorted member ids, so a decision lapses (is re-reviewed) if group membership changes.
* No new fields on Offering. Sparse by construction: the absence of `minimumQuantity` / an Offering-scoped Price **is** inheritance.

Resolution rules (shared by the portal read contract and the admin read model):

1. Standard Offering price = Offering-scoped live Price in force on the service date, else Item-scoped default Price. Exactly one per tier or the Offering is not bookable (fail closed, ambiguous defaults included).
2. Quote-only Offerings never inherit a price (existing invariant preserved).
3. Minimum = `Offering.minimumQuantity ?? Item.defaultMinimumQuantity`.
4. Archived Items vanish from active booking menus (existing `activePublished` check).
5. UI tags: `INHERITS` (value from the company default), `OVERRIDES` (Offering value, company default exists), `SITE VALUE` (Offering value but the Item has no company default yet, i.e. pre-canonical data, not an override of anything), `NOT SET`, `QUOTE ONLY`. A site value equal to the default is flagged "same as company default" and cannot be saved as a new override.

Consumers updated: `hospitalityPortalReadFromRecords` (inheritance), `loadMnkBookingCatalogue` (+1 bounded query of Item-scoped Prices by the same stable Item ids), `schema-catalogue`. Provider = Hub; consumers = Hospitality portals via the portal read contract and the booking price-trust path (both inside the Hub). Contract version string unchanged: the response shape is identical, only the resolution of `price` and `constraints.minimumQuantity` widened.

## 3. Commands (`lib/hospitality-catalogue-admin.ts`, `POST /api/hospitality-catalogue`)

All single Firestore transactions, all gated by `hospitality.catalogue.manage`, all version-checked, all audited. Nothing is hard-deleted.

| Command | Safety |
| --- | --- |
| `create-item` | Replay-safe id derived from `requestId`; duplicate name (active **or** archived) and provider-reference clashes refused; routing choice, default price (<= 2 dp) and >= 1 active OPLOC required; Item + default Price + Offerings + routing + audit commit together or not at all. |
| `update-item` | `expectedVersion`; the default-price change rides in the same transaction (one Save never half-applies). |
| `set-default-price` | Old default end-dated the day before (UK date) or archived if it never took effect; stale/no-op refused. |
| `set-routing` | One of the four explicit choices; `expectedRoutingVersion` (0 = unresolved) so a stale or repeated first-time save fails; clears any supersede marker. No name guessing: the only hint is the existing exact-source-id suggestion, displayed but never applied. |
| `set-item-status` | Archive/restore; Offerings, Prices, routing, revisions kept; restore refuses a duplicate active name. |
| `add-offering`, `set-offering-status` | Enable/disable per OPLOC; re-enabling revives the archived Offering (keeps its overrides); duplicates refused. |
| `set-offering-override` | Price / minimum / local wording; `null` = reset (override Price archived, field removed); equals-default refused; Offering `expectedVersion` so concurrent override edits fail safely. |
| `adopt-company-default` | Operator-confirmed default (see section 6). Equal site values become inherited (override Price archived / minimum removed); different values stay as overrides. |
| `merge-items` | Explicit operator decision. Blocks (atomically, nothing written) on allergen/dietary difference, same-site Offering clash, differing default price/minimum, disagreeing routing. Repoints Offerings (source name kept as local wording), carries routing, writes merge map + decision + audit. |
| `record-review-decision` | `keep_separate` / `defer`. |

Audit actions: item created/edited/archived/restored, default price changed, default minimum changed, routing changed, offering enabled/disabled, override set/removed, items merged, kept separate, review deferred. Each carries actor, timestamp, `details.before/after`, Item id, and OPLOC/Offering id where relevant, and is written in the same transaction as the mutation (no best-effort client logging).

AUTHMOD: `hospitality.catalogue.manage` is granted via `CanonicalPermissions` to `integration-admin` only; reviewers/viewers get the read-only screen (`canonical.view`) with no create/edit/archive controls and a 403 on any POST. No hard-coded emails.

## 4. Read shape (COST-EFFICIENCY.md)

* Screen open / explicit reload: 4 bounded `entityType` queries (Items, Offerings, Prices, OPLOCs; <= 1000 each, 503 on overflow) + routing + merge map + review decisions. About 400 documents for today's ~90 Items. No polling, no listeners, no collection scan of unrelated entities.
* After the operator's own mutation: targeted refresh of the touched Items only (per Item: 1 doc + 1 relation query + 1 Offering-price query + 1 routing doc). Merges / review decisions return a full reload.
* Mutations read only the affected aggregate (Item + its Offerings/Prices by stable id) plus one bounded Item query where a duplicate-name check is required.
* Side effect: the Connections overview no longer reads the whole routing collection or builds `menuItems` (removed with the old screen).

## 5. Canonicalisation (before and after)

The screen is correct before canonicalisation (site copies listed, flagged by a banner; site prices shown as `SITE VALUE`; unmerged Items have no default) and after (one row per product; Offerings repointed; routing on the survivor; Prices become `OVERRIDES` until a default is adopted). Canonicalisation itself is untouched and still requires the explicit `--apply` + approved plan hash flow. Ambiguous (review) groups are never auto-merged; the UI comparison offers Same product - merge / Keep separate / Defer.

## 6. Price / minimum migration rule (report-only analysis)

Per Item with no company default, over its active standard Offerings:

* all prices equal (amount and VAT) **and** all minimums equal (or all absent) -> propose that as the default, no overrides (`uniform`);
* otherwise -> `operator_required`: no governed business rule exists to prefer lowest / highest / first, so the operator must type the default. Different site values then remain as overrides.

Nothing is applied by analysis; `adopt-company-default` is an explicit, confirmed, audited command.

## 7. Architectural exceptions

None required: routing is per Item and no site-level routing override was added or found. (`HOSPITALITY_GOVERNED_ROUTING_PLATFORMS`, which gates hand-off enforcement per platform, is unchanged and orthogonal.)

## 8. Known limitations

* Allergen/dietary data is read-only here and blocks merges when it differs; editing it stays with the existing governed path.
* The legacy `GET /api/hospitality-menu` (`menuForMnkPortal`) still reads a legacy `unitPrice` field and does not resolve company defaults; it is not the pricing authority (booking pricing uses the portal read contract path).
* `POST /api/hospitality-menu/catalogue` remains for existing callers but has no UI.
