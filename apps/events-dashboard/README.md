# FIKA OS Events Dashboard

A standalone full-stack FIKA OS application for direct Event creation, operational planning, readiness and lifecycle management.

## Local setup

```powershell
cd C:\FIKA\apps\events-dashboard
Copy-Item .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`.

## Commands

- `npm run dev` — local application.
- `npm test` — domain, persistence, validation and identity tests.
- `npm run typecheck` — strict TypeScript check.
- `npm run lint` — frontend/backend lint.
- `npm run build` — production build verification.
- `npm run db:migrate` — repeatable SQLite setup.
- `npm run db:seed` — verifies synthetic configuration without fabricating Events.

## Brand and interface foundation

The dashboard uses the approved FIKA logo, Vim display type and Gilroy interface type from the authoritative local brand assets. Reusable semantic tokens live in `app/styles/fika-tokens.css`; application styling consumes them from `app/globals.css`.

See [FIKA OS brand foundation](docs/brand-foundation.md) for source assets, usage rules, accessibility decisions and the remaining compact-icon question.

## Product workflow

Users can view and filter the operational schedule, create an incomplete Draft, reopen and edit it, add staffing and production requirements, assign tasks, inspect transparent readiness, progress through guarded lifecycle transitions and cancel without deleting history.

The schedule uses `recordType: EVENT` and is prepared for future `BOOKING` records. Booking ingestion is not implemented.

## Persistence

SQLite is used only for local persistence. `EventRepository` isolates data access so a future hosted database can replace SQLite without changing the Event domain or UI. Migration `db/migrations/001_events.sql` creates Events, indexes and durable save-request records. Writes are transactional; request IDs make creation/update retries safe, while record versions prevent accidental overwrite.

## Configuration and identity

`lib/config.ts` provides explicitly synthetic OPLOCs, sites, people, staffing roles and production units behind a single configuration module. No real contact details or live records are included.

During local development, the API uses the synthetic identity declared in `.env.example` and the interface displays **Development identity**. In a future hosted environment, the reverse proxy must provide authenticated `x-fika-user-id` and `x-fika-user-name` headers. Every API route authorises server-side; production does not fall back to the development identity.

## Readiness

- Details: required Event brief, schedule, pax, OPLOC, site, Event Contact and owner.
- Staffing: each requirement is complete when fully assigned or explicitly unresolved.
- Production: item, positive quantity, explicit unit, required time, intended producer and destination.
- Tasks: all tasks are Done or Cancelled; blocked and overdue tasks are called out separately.
- Overall: four equally visible areas, 25% each. Readiness never changes lifecycle automatically.

## Boundaries

- Staffing assignments are Event planning records, not official Workforce rota entries. No availability claim or shift publication occurs.
- Production requirements are Event planning records, not Production Orders. Quantity is never inferred from pax.
- Existing hospitality dashboards, booking portals, Calendar workflows, CPU Dashboard and reconciliation tooling are unchanged.
- No Google, provider, email, live Booking or live employee integration exists.
- Deployment, hosted authentication, Booking ingestion, authoritative configuration and CPU/Production handoff are deferred.

## Future deployment

A hosted runtime will need persistent database storage, managed migrations, authenticated identity headers, secrets/configuration management, backups and operational monitoring. No hosting platform is selected or deployed here.
