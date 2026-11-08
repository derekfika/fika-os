# 2026-11-07 — Extract and review local Beverage recipe documents

Add local DOCX, PPTX and selectable-text PDF adapters with bounded multipart, ZIP, XML and PDF parsing. Preview multiple candidates with duplicate warnings and require explicit review of one candidate before saving. Re-extract the exact original bytes on commit. Persist only reviewed draft fields, audit evidence and source fingerprints. Google Docs and Slides can be manually exported or pasted.

Validation: 28 app tests, six isolated Firestore emulator tests, typecheck, Webpack build, and both dependency audits with zero vulnerabilities. Fixtures cover three formats, reordered slides, malformed and oversized inputs, multipart caps, changed source bytes and idempotent persistence.

Deployment: none.
