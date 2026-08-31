# AUTHMOD vehicle entitlement

Logistics vehicle access is exposed through the existing Integration Hub admission boundary as `permittedVehicleIds`. The stable IDs currently recognised by the contract are `van1` and `van2`; display labels such as “Van 1” remain presentation values.

The existing governed AUTHMOD relationship is an explicit `AuthorityGrant` with:

- `appId: "logistics"`;
- `resource: "logistics.vehicle"`;
- `action: "View"`; and
- a `resource` scope containing the stable vehicle ID.

The repository currently does not contain approved vehicle assignments for real users, and this change intentionally creates none. A human governance decision is still required to confirm the vehicle catalogue, the approving role, whether assignments are temporary/effective-dated, and which reviewed identities may receive each grant.

Until those grants exist, vehicle-specific admission is denied. Existing Full Access grants cover standard application/site access only and do not implicitly grant this special vehicle authority.
