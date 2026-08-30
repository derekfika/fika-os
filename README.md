# FIKA OS

FIKA OS is FIKA’s internal operations platform: a set of Next.js applications and shared server/domain packages covering bookings, menus, production, fulfilment, logistics and governance.

## Applications

- **Integration Hub** — launcher, governed integrations and AUTHMOD/session admission.
- **CPU Production** — production planning and operational CPU work.
- **Menu Planning** — menu intent, portions, destinations and publication.
- **Hospitality Booking** — booking, quoting and hospitality menu workflows.
- **Delivered-In** — site-facing delivered-in operational projection.
- **Logistics** — delivery planning, van assignment, dispatch and collection.
- **Ad-Hoc Production** — ad-hoc request and CPU hand-off workflow.
- **Beverage Innovation** — beverage development workflows.
- **Events Dashboard** — event operations and staffing views.

## Repository structure

`apps/` contains the active application packages. `packages/server-shared/` contains reusable server-side contracts and adapters. `docs/` contains architecture, audit and operational guidance. `sites/` contains legacy Apps Script-era applications retained for compatibility and recovery. App-local `local-data/` directories are runtime or fixture areas; mutable local state is not source control.

## Runtime architecture

Applications use the Next.js App Router and deploy through Firebase App Hosting. Firestore is accessed server-side through Admin SDK-backed services. Integration Hub is the canonical integration and governance boundary, including AUTHMOD admission. App-to-app communication uses explicit HTTP/API contracts; production code must not import sibling application server source, and browser paths do not access Firestore directly where the current trust boundary forbids it.

## Local development

The repository uses independent app packages rather than npm workspaces. Install dependencies in the app you are working on, then use its package scripts. For example:

```text
npm --prefix apps/integration-hub run dev
npm --prefix apps/logistics run test
npm --prefix apps/logistics run typecheck
npm --prefix apps/logistics run build
```

The root supervisor also provides `npm run dev` and app-specific `dev:*` shortcuts. Check each app’s `package.json` for its current scripts.

## Staging

The staging Firebase project is `fika-os-dev`. App Hosting configurations use friendly `*.fikacatering.com` domains, with `staging-os.fikacatering.com` for the Integration Hub and app-specific staging hosts where configured. Deployments are managed by Firebase App Hosting. Secrets are referenced by configuration names and must never be committed with values.

## Safety and data rules

- Do not run production/staging migrations casually; Firestore migrations require explicit approval.
- Do not commit local SQLite databases, WAL/SHM files, runtime caches or backups.
- Preserve read-budget instrumentation and use bounded, stable-ID/date-scoped reads.
- Avoid sibling-app source imports in production; use shared packages or app-local HTTP adapters.
- Avoid GET endpoints with surprising write side effects.
- Preserve AUTHMOD fail-closed behaviour and use configured friendly/runtime URLs rather than hardcoded localhost or generated hosts.
- Never expose secrets in source, logs or documentation.

## Testing

For a change, run the narrow focused tests first, then the affected app’s full tests, typecheck and production build as appropriate. Finish with `git diff --check` and review staged file scope. Do not deploy, migrate or push until those results and the intended diff have been reviewed.
