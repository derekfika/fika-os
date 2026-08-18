# Local Emulator Recovery

Integration Hub emulator exports contain private workforce evidence. They are stored under `local-data/integration-hub/recovery/`, outside Git, and must not be shared or committed.

## Create a verified backup

With the normal local emulators running:

```powershell
cd C:\FIKA\apps\integration-hub
npm run recovery:backup
```

The command exports every emulator collection and writes `inventory.json` containing collection counts, deterministic content hashes, schema versions and export-file hashes.

## Start from an export

```powershell
npx firebase emulators:start --config firebase.json --import C:\FIKA\local-data\integration-hub\recovery\<backup-folder>
```

Do not use this command against the working ports while the normal emulator is running.

## Verify an isolated clean restore

The recovery config uses isolated ports (`8185` for Firestore and `9199` for Auth):

```powershell
npx firebase emulators:exec --config firebase.recovery.json --only firestore,auth --import C:\FIKA\local-data\integration-hub\recovery\<backup-folder> "npm run recovery:verify -- C:\FIKA\local-data\integration-hub\recovery\<backup-folder>\inventory.json"
```

Verification succeeds only when every restored collection has the same document count and deterministic content hash. It never overwrites or resets the working emulator.
