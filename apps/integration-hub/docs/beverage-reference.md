# Beverage reference access

This Hub surface is disabled by default. Local tests use fictional identities and objects. No Beverage client, hosted setting, registry seed, identity enrollment or grant is provisioned here.

| Request | Result |
| --- | --- |
| `GET /api/internal/beverage/reference/oplocs?oploc=<id>` | Requested canonical OPLOC IDs and approved labels |
| `GET /api/internal/beverage/reference/manifest?oploc=<id>` | The pinned ingredient snapshot version and ingredient counts, sizes and hashes |
| `GET /api/internal/beverage/reference/ingredients?oploc=<id>&version=<pin>` | Exact raw gzip bytes for the pinned ingredient snapshot |

Every request carries an audience-bound Google ID token for the dedicated Beverage server identity and the human's canonical FIKA session cookie. The server identity is matched by exact subject and service-account email. The person controls the decision. Hub verifies the Firebase cookie with revocation checking and looks up the existing unique person UID binding. It requires an effective direct Beverage app assignment and an [explicit Beverage View entitlement](beverage-oploc-entitlement.md) covering every requested canonical OPLOC. Generic SiteAssignments and Full Access confer no Beverage authority. Supply between one and 100 `oploc` parameters. Historical request IDs resolve inside the same read-only snapshot as the active-site and entitlement checks. Results omit grant IDs, identity data and unrelated sites.

The adapter calls neither the general session resolver nor the existing OPLOC and Food Data GET routes. Missing or stale AUTHMOD or OPLOC evidence denies access without publishing a package. Food Data reads are limited to `manifest.json` and `ingredients.json.gz` at the exact v1 prefix derived from the configured version. The manifest is capped at 64 KiB, compressed data at 5 MiB and JSON at 40 MiB. The reader checks the compressed and JSON byte counts and SHA-256 hashes before returning raw gzip without a Content-Encoding header. The product data is source evidence and carries no recipe costing or allergen approval.

## Hosted activation gates

The code requires explicit staging mode and the `fika-os-dev` project, plus the following runtime settings. Food Data access also honors the Hub Food Data kill switch. This PR sets none of them.

| Setting | Required evidence |
| --- | --- |
| `FIKA_BEVERAGE_REFERENCE_ENABLED` | Governed activation approval |
| `FIKA_BEVERAGE_REFERENCE_AUDIENCE` | Exact `https://staging-os.fikacatering.com/api/internal/beverage/reference` audience |
| `FIKA_BEVERAGE_REFERENCE_CALLER_SUBJECT` and `FIKA_BEVERAGE_REFERENCE_CALLER_EMAIL` | Verified dedicated staging Beverage service-account identity |
| `FIKA_BEVERAGE_FOOD_DATA_BUCKET` and `FIKA_BEVERAGE_FOOD_DATA_VERSION` | Explicit canonical staging bucket and approved immutable `<snapshot>:<gzipSha256>` pin for Food Data access |

Before OPLOC activation, verify the actual request path and forwarding of the separate Google credential and FIKA cookie, exact Firebase issuer and environment, current read-only AUTHMOD and OPLOC packages, and the audited Beverage app assignment and direct View entitlement for the already-bound person. Leave both Beverage Food Data settings unset for OPLOC-only activation. Before separately activating Food Data, verify that the serving storage credential has only object-get access on the two authorised objects for this path. The source restricts the operations and names. Effective runtime IAM and the identity used by the default Hub storage client require independent verification. If the approved boundary needs a dedicated credential, isolate it before activation.

Review the release candidate for Hub dependency vulnerabilities and authorise which ingredient fields the Beverage server may disclose to each audience. Validate real external Gmail sign-in only with an owner-authorised, explicitly enrolled account. Beverage data persistence and operational effect gates are separate. #423 and #429 remain open.
