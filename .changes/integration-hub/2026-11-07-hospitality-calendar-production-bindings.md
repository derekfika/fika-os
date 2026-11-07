# Hospitality Calendar production bindings

- Date: 2026-11-07
- Task: #348 production Calendar bindings
- Summary: Added the approved Hub runtime identity, dedicated DWD issuer and verified Logistics mailbox to the production App Hosting manifest. Enabled only protected read-only preview and explicitly disabled Calendar writes; canonical site mailbox identities remain sourced from Hub.
- Validation: `git diff --check` passed. No local YAML parser is installed in this isolated checkout; exact-source CI remains the manifest/build validation gate.
- Deployment: Not deployed by this change; live Calendar writes remain disabled pending exact catch-up approval.
