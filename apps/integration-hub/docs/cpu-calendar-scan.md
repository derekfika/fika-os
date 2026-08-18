# CPUX Calendar scan

The CPU scanner reads the configured `cpux@fikacatering.com` Google Calendar
through the read-only Calendar API. It does not read Gmail and it does not
write Calendar events. The existing Angel Court Gmail scanner is a separate
adapter.

## One-time local authorisation

1. Enable Google Calendar API and Google Drive API in the local development
   Google Cloud project.
2. Put a desktop OAuth client JSON at
   `C:\FIKA\secrets\calendar-oauth-client.json` (or set
   `CPU_CALENDAR_OAUTH_CLIENT_FILE`).
3. From `apps/integration-hub`, run:

   ```text
   npm run auth:cpu-calendar
   ```

4. Complete the browser flow using the Workspace account
   `cpux@fikacatering.com`. The script requests read-only Calendar and Drive
   access and writes `C:\FIKA\secrets\cpu-calendar-token.json`.
5. Start the local emulator and Integration Hub, then use **Scan CPU
   calendar** in the CPU Production dashboard.

The scan uses a seven-day lookback and sixty-day lookahead by default. Adjust
`CPU_CALENDAR_LOOKBACK_DAYS` and `CPU_CALENDAR_LOOKAHEAD_DAYS` locally if
needed. Calendar events are deduplicated by the stable calendar ID and event
ID; rescanning updates the existing candidate rather than creating another
Booking.

## Offline development

Set `CPU_CALENDAR_SNAPSHOT_FILE` (or `CPU_CALENDAR_SNAPSHOT_JSON`) to use a
local fixture instead of Google. This is useful when credentials are not
available and makes no external requests.

Calendar events with incomplete or inaccessible attachments are retained as
review candidates. The adapter never invents menu or booking details.
