# FIKA OS Beverage Innovation

Beverage Innovation owns beverage concepts, recipe development evidence, approvals and local launch plans. It is a distinct domain from Menu Planning, which remains the authority for operational menu publication.

The approved Stage A presentation is preserved at `/mock`. The current AI-generated or illustrative drink imagery is placeholder content; actual photography of each drink is required before final visual approval or release. Stage B can record operational and brand review decisions, but the lifecycle cannot enter final `approved` until an approved photo asset reference is recorded. Since this increment does not source or upload real photos, final approval/release remain gated. See [the visual comparisons](visual-evidence/README.md).

## Stage B local application

Stage B adds local Firestore persistence and tested domain workflows behind a fail-closed development boundary. The app uses a dedicated Beverage collection set and a local Firebase emulator only. Firebase Admin is server-side; Firestore client rules deny access. Fixture actor and OPLOC identities are fictional. Every write is version-checked, idempotent, and committed with an append-only audit event.

The root pipeline at `/` supports concept creation, lifecycle changes, recipe editing, quantity/cost calculations, version history and approvals. `/specials` supports date windows, approved recipe selection and explicit fixture-site assignments. `/imports` parses pasted source text, shows warnings and a source fingerprint, then requires an explicit action to create a local draft. Allergens and costs are never inferred by the importer; unconfirmed ingredient sources remain deferred.

Stages C/D integrations and deployment are blocked pending stabilisation and separate owner authorization. In particular, this work does not clear #423 or #429. No production/staging data, notifications, external integration, Menu Planning publication, deployment or release is authorized by this implementation.

See [Beverage development governance and preview instructions](DEVELOPMENT.md) for boundaries, local setup, emulator configuration and validation commands.

## Source recipes

The prior in-memory cocktail examples are retained only in the Stage A mock presentation as fixture content. Stage B application records are created deliberately in the local emulator or through the reviewed import preview; no recipe deck is silently bulk-loaded into persistent storage.
