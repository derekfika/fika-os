# FIKA OS Beverage Innovation

Beverage Innovation owns beverage concepts, recipe development evidence, approvals and local launch plans. It is a distinct domain from Menu Planning, which remains the authority for operational menu publication.

The approved Stage A presentation is preserved at `/mock`. The current AI-generated or illustrative drink imagery is placeholder content; actual photography of each drink is required before final visual approval or release. Stage B can record operational and brand review decisions, but the lifecycle cannot enter final `approved` until an approved photo asset reference is recorded. Since this increment does not source or upload real photos, final approval/release remain gated. See [the visual comparisons](visual-evidence/README.md).

## Stage B local application

Stage B adds local Firestore persistence and tested domain workflows behind a fail-closed development boundary. The app uses a dedicated Beverage collection set and a local Firebase emulator only. Firebase Admin is server-side; Firestore client rules deny access. Fixture actor and OPLOC identities are fictional. Every write is version-checked, idempotent, and committed with an append-only audit event.

The root pipeline at `/` supports concept creation, lifecycle changes, recipe editing, quantity/cost calculations, version history and approvals. `/specials` supports date windows, approved recipe selection and explicit fixture-site assignments. `/imports` parses pasted source text, shows warnings and a source fingerprint, then requires an explicit action to create a local draft. Allergens and costs are never inferred by the importer; unconfirmed ingredient sources remain deferred.

## Restricted Stage A staging preview

The owner authorized a dedicated no-write visual preview on 7 November 2026. The staging app root renders `/mock`; interactions remain in browser memory, and `proxy.ts` removes Beverage data APIs from preview routing. The only exposed API is `/api/build-info`, which returns the exact build SHA and a `previewOnly` marker. The preview validates the shared FIKA staging session against `fika-os-dev` with revocation checking and currently allowlists the verified owner account. Do not add reviewers without explicit authorization. Sign in through the staging Hub when prompted, then return to Beverage with browser Back or reopen the Beverage URL; the Hub's staging return allowlist is intentionally unchanged in this Beverage-only scope.

The staging App Hosting config points Firestore at loopback and the Stage B API continues to reject every non-local mode. No Firestore, Calendar, Drive, operational data, notifications, external integrations or Menu Planning publication are part of the preview. Use the governed `fika deploy beverage --staging` path only after exact-source CI and first-release containment validation. There is intentionally no production target. The domain is `https://beverage-staging.fikacatering.com` after its DNS and TLS records are configured.

This staging visual review does not clear #423 or #429, and it is not final visual acceptance. Placeholder drink images remain provisional; actual approved photographs are required before final asset approval or production release. Functional staging writes remain disabled until the database, AUTHMOD permissions, OPLOC scope and external-effect boundaries are independently verified.

See [Beverage development governance and preview instructions](DEVELOPMENT.md) for boundaries, local setup, emulator configuration and validation commands.

## Source recipes

The prior in-memory cocktail examples are retained only in the Stage A mock presentation as fixture content. Stage B application records are created deliberately in the local emulator or through the reviewed import preview; no recipe deck is silently bulk-loaded into persistent storage.
