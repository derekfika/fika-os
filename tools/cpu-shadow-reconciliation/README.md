# CPU Shadow Reconciliation

## Purpose

This package is the bounded Stage 7 Increment 1 offline seam. It validates synthetic `fika.cpu-intake-snapshot` 1.0.0 files and produces deterministic reconciliation evidence without constructing canonical Production Orders.

All snapshots, configuration, shadow identities and outputs are non-canonical test or evidence artefacts. The package does not replace the existing CPU workflow.

## Requirements and installation

- Node.js 24.x
- npm 11.x

From this directory:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
```

Dependencies are package-local and pinned by `package-lock.json`.

## Commands

An explicit absolute output directory and `as-of` timestamp are mandatory.

Validate a snapshot:

```powershell
npm run validate -- --input fixtures/synthetic/valid/monday-to-friday.json --config config/increment-1.test-config.v1.json --output-dir C:\temp\fika-cpu-shadow-evidence --as-of 2026-07-25T00:00:00+01:00
```

Generate reconciliation evidence:

```powershell
npm run reconcile -- --input fixtures/synthetic/valid/monday-to-friday.json --config config/increment-1.test-config.v1.json --output-dir C:\temp\fika-cpu-shadow-evidence --as-of 2026-07-25T00:00:00+01:00
```

Run tests:

```powershell
npm test
```

Accepted evidence is written beneath `validation/` or `reconciliation/`. Rejected input produces evidence beneath `quarantine/`. Existing evidence is never overwritten with different bytes.

## Snapshot contract

The strict Draft 2020-12 contract is `contracts/cpu-intake-snapshot.schema.json`:

- contract name `fika.cpu-intake-snapshot`;
- version `1.0.0`;
- synthetic classification only;
- explicit source provenance, replay window, timezone and `as-of`;
- CPUX (`oploc:cpux`) as producing OPLOC;
- `cpux@fikacatering.com` as intake reference only;
- canonical-JSON SHA-256 integrity over observations;
- unknown fields rejected; and
- warnings, uncertainties, exclusions and omissions preserved.

The versioned test configuration records FIKA Xchange (`oploc:fika-xchange`) as host and CPUX as hosted/producing. That hosting assertion is explicitly test-only and non-canonical. It is not the future Operational Location Relationship contract.

## Evidence and identity boundaries

Reconciliation evidence keeps these identities separate:

- snapshot;
- source observation;
- source record;
- shadow order and shadow line;
- mapping run;
- reconciliation run;
- discrepancy; and
- evidence export.

All derived identities use canonical content hashing without randomness. Arrays and object keys use stable ordering, making equivalent reruns byte-identical.

## Safety boundary

The package is non-interactive and uses only local filesystem input/output. It fails closed on invalid schemas, configuration, identity, integrity, window or `as-of` evidence. Output is confined to the explicitly supplied absolute directory.

Deliberately unsupported:

- network or provider access;
- Google Calendar, OAuth or service accounts;
- live or sanitised-source extraction;
- production credentials;
- live OPLOC/reference-data changes or OPLOC administration;
- canonical Booking, Production Order, Production Line or relationship persistence;
- Production routing, conversion/yield or lifecycle decisions;
- notifications, databases, hosted services or deployment; and
- universal match scores or guessed defaults.

Eligibility, lifecycle, required-ready time, stable line identity, units, conversion/yield, routing, dietary/allergen allocation, amendments and cancellations remain explicit uncertainties or exclusions where source evidence cannot establish them.
