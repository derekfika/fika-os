# FIKA OS Beverage Innovation

Local development workspace for the governed beverage innovation journey. The app is intentionally separate from Menu Planning: Menu Planning owns delivered-in lunch plans, while this domain owns beverage concepts, development evidence, approvals and site rollout intent.

## Workflow implemented

`Idea → In development → Ready for approval → Brand review → Approved → Asset generation → Rollout → Live → Review → Archived`

The detail workspace keeps concept, development/prototypes, immutable versions, recipe/method, costing, equipment, allergen status, assets, approvals, rollout readiness, feedback and audit history in separate tabs. Lifecycle commands validate the stage transition, require operational and brand approvals before approval, and block go-live while a rollout has blockers.

## Decisions applied

- Beverage Innovation is a distinct domain.
- Recipes and versions are distinct from Menu Planning dishes.
- Administrator/role-based approval is the temporary authority for this increment.
- Site rollout and beverage assets are owned here for now.
- Ingredient/product sourcing, canonical allergen derivation and performance source remain explicitly deferred.
- People are represented by roles, not named individuals.

## Local-only boundary

The API is an in-memory development store (`/api/beverages`). It does not publish records, change Canon, call suppliers, create till items, replace training, send notifications, or connect to external asset/performance systems. Ingredient lines retain a `deferred` source status rather than inventing allergen or product truth.

The first source import is `Cocktails Drinks Recipe.pptx`: Espresso Martini, Elderflower Fizz, Mojito, Strawberry Basil Lemonade and Butterfly Passion Cooler. These are source-evidence development records; the import is name-idempotent and does not create duplicates.

## Verification

Run from this directory:

```text
npm run typecheck
npm test
npm run build
```
