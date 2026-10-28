# 2026-10-28 — Restore explicit Logistics vehicle access

The shared staging Logistics account had normal app access but no vehicle View grants. An audited, staging-only repair grants exactly Van 1 and Van 2 through the existing AUTHMOD grant service, including access-head/package refresh. The account identity, Full Access flag, normal app permissions and mobile PIN controls are preserved. The guarded repair command defaults to read-only and verifies the authenticated Cloud SDK operator is an existing AUTHMOD administrator.

Fix issue #101: retain original vehicle IDs when filtering AUTHMOD decisions, preventing a Van 2-only permission from being misreported as Van 1. No shared contract changes, operational-data migration or new recurring read/audit behavior. The configuration repair creates one ordinary authority audit event and refreshes only that identity's derived access package.

Validation: baseline regression reproduced Van 2-to-Van 1 misbinding; corrected focused Hub authorization tests and 145 Logistics resource/driver regression tests pass. Full governed validation passed: 816 Hub tests, 101 intentional emulator skips, typecheck and production build. The initially missing specification dependency was restored from the exact gitlink SHA. Added separate maintenance/admin denial coverage. Production/wrong-project repair refusals are covered. Actual staging policy dry run and audited write verified both vehicle IDs and unchanged identity. The real shared-account browser session returned both permitted vehicle IDs and HTTP 200 for vehicles, syncHead, planningAttention, projection, main planner and week summary.

Deployment: staging policy repair applied in fika-os-dev. Hub source deployment and browser acceptance pending at entry creation; production untouched.
