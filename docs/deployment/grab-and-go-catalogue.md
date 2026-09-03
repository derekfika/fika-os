# Grab & Go catalogue deployment boundary

CPU Production owns the Grab & Go catalogue. The catalogue is published as an immutable gzip/SHA-256 read package in the configured `FIKA_SNAPSHOT_BUCKET` under the `snapshots/cpu-production/grab-and-go-catalogue` dataset. Delivered-In consumes the CPU internal API and never reads a local catalogue file in hosted mode.

Publish a governed source file only after the Operations/CPU catalogue owner has approved it:

```powershell
cd C:\FIKA-UAT\apps\cpu-production
npx tsx scripts/publish-grab-and-go-catalogue.ts C:\path\to\approved-grab-and-go-catalogue.json
```

The source must have this envelope:

```json
{
  "schemaVersion": 1,
  "products": []
}
```

The publisher validates stable product IDs, rotation weeks, delivery weekdays, active state, sort order and product uniqueness before advancing the manifest. Missing or corrupt packages fail closed; no mutable app-local file is a hosted fallback.
