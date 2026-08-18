# Angel Court inbox compatibility adapter

The legacy Angel Court workflow scans Gmail for XLSX booking attachments with:

`in:anywhere -in:trash -in:spam filename:xlsx`

The local adapter at `POST /api/angel-court/inbox` accepts one exported XLSX attachment plus its message metadata and returns a parsed, reviewable candidate. It preserves the legacy source key (`messageId|attachmentName`) and the core Angel Court field and line-item conventions.

This route is intentionally dry-run only. It does not connect to Gmail, write Firestore, create a Booking, archive mail, or create a Google Sheet. This prevents local development from mutating live business data while the parser is compared with the existing Apps Script behaviour.

## Local emulator worker

Copy `local-fixtures/angel-court/manifest.example.json` to `manifest.json`, place the referenced XLSX files in that directory, start the Firebase emulators, and run:

`npm run worker:angel-court:local`

The worker reads the fixture mailbox, applies the same source-key deduplication, parses each attachment, and writes only to emulator collections `angelCourtInboxRuns` and `angelCourtInboxCandidates`. It never creates canonical Bookings. Re-running the worker is idempotent for an unchanged fixture.

## Local Gmail worker

After completing the one-time local OAuth flow (`npm run auth:gmail`), the Gmail-backed worker can be run while the Firebase emulators are running:

`npm run worker:angel-court:gmail`

It uses the authorised mailbox represented by the token (`users/me`), the legacy XLSX query, and the same parser and source-key ledger as the fixture worker. It downloads only XLSX attachments, records source evidence and review candidates in the emulator, and keeps canonical Booking writes disabled. Use `ANGEL_COURT_GMAIL_MAX_MESSAGES` to bound a development scan (for example `5`) and `ANGEL_COURT_GMAIL_QUERY` or `ANGEL_COURT_EARLIEST_SCAN_DATE` to narrow it. OAuth files default to `C:\FIKA\secrets\gmail-oauth-client.json` and `C:\FIKA\secrets\gmail-token.json`; override with `GMAIL_OAUTH_CLIENT_FILE` and `GMAIL_OAUTH_TOKEN_FILE` when required.

`npm run worker:angel-court:gmail:scheduler` runs the same worker once per 15-minute slot on weekdays from 07:00 through 17:00 Europe/London. The `angelCourtInboxState/gmail` checkpoint records the last successful scan; a forced scan from the Angel Court dashboard runs immediately but still only considers messages newer than that checkpoint. Failed runs record an error without advancing it. The dashboard's **Scan inbox** button calls `/api/angel-court/inbox/scan` and displays the last successful scan time.

## Production boundary

When authorised for deployment, the future server-side worker should run the same query/parser behind a Gmail read-only service account or Workspace domain-wide delegation, store a processing ledger keyed by `messageId|attachmentName`, and submit explicitly reviewed candidates through the canonical Booking ingestion command. Firebase Hosting alone cannot scan Gmail; use a server-side scheduled worker (Cloud Functions or Cloud Run) for that boundary.
