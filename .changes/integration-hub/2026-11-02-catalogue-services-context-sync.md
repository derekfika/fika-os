# 2026-11-02 — Remount the service editor on navigation context changes

Keyed the Services/Locations editor from its selected location, service, Item and category context so browser history and tab changes restore the correct view without synchronously setting state from an effect. Cleaned up scoped lint findings in the component and its regression test.

Validation: `npm run typecheck` passed; `npx tsx --test tests/hospitality-catalogue-services.test.ts` (4 passed); scoped ESLint passed.
Deployment: none.
