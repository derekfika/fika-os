# FIKA Workforce Operations Platform

Starter Apps Script project for rota management, relief planning, agency tracking
and BrightHR sync.

## BrightHR credentials

Do not commit BrightHR credentials to Git.

Store them in Apps Script Script Properties by running:

```js
setBrightHrApiCredentials(
  "PASTE_CLIENT_ID",
  "PASTE_CLIENT_SECRET"
);
```

The connector defaults to BrightHR's documented endpoints:

- Token URL: `https://login.brighthr.com/connect/token`
- API base URL: `https://api.bright.hr`

Then check:

```js
getBrightHrApiStatus()
```

```js
testBrightHrConnection()
```

To test the first employee endpoint:

```js
testBrightHrEmployeesQuery(5)
```

## BrightHR docs used

- Getting started: https://docs.bright.hr/gettingstarted

## BrightHR information still useful

Ask BrightHR for the detailed absence/holiday/sickness endpoints, rate limits,
and whether sandbox/test mode exists.

If API access is limited, the same platform can still support CSV imports from
BrightHR exports.

## Legacy rota import

Upload the old rota workbook to Google Drive and open/convert it as a Google
Sheet. Then run:

```js
setLegacyRotaSpreadsheetId("PASTE_LEGACY_ROTA_GOOGLE_SHEET_URL")
previewLegacyRotaImport(3)
importLegacyRotaSheet()
```

The importer reads weekly tabs like `JANUARY Week 1 2026`, tracks the current
site down the left-hand column, and imports each day/status pair into structured
`Rota Shifts` rows. Agency rows are also copied into `Agency Requests`.

For the smarter compressed import, use:

```js
previewLegacyStandardRota(6)
previewLegacyRotaCompressedImport(3)
importLegacyRotaCompressed()
```

This creates recurring `Rota Templates` and only stores dated changes in
`Rota Exceptions`. The default cutover date is `2026-06-29`, so historical
January-June rota data is skipped.

If an earlier full import created too many rows, run:

```js
clearLegacyRotaShiftNoise()
clearLegacyCompressedImport()
```

## Relief rota import

Upload/convert the relief rota workbook to Google Sheets, then run:

```js
setReliefRotaSpreadsheetId("PASTE_RELIEF_ROTA_GOOGLE_SHEET_URL_OR_ID")
previewReliefRotaImport()
importReliefRota()
```

The importer only reads the `2026` tab and only imports dates from `2026-06-29`
onwards.
