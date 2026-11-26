# 2026-11-26 — Preserve completion evidence in orphan recovery

Orphan reconciliation now requires and archives the existing exact completed and retired record for each allowlisted bootstrap task, while preserving the completion record and remote branch. Operation startup establishes its marker under the filesystem-only capacity lock and checks checkout HEAD after releasing the lock. Registration checks also protect the task branch if registered at another path.

Validation: `node --test --test-name-pattern='operation markers revalidate|orphan bootstrap preview|recovery admission' tools/workflow/source-workspaces.test.mjs` passed (3/3); `npm run fika -- changelog check --base origin/main` passed; `git diff --check` passed. The full workflow suite was left to the campaign owner’s concurrent validation run and was not independently repeated in this checkout.
Deployment: none.
