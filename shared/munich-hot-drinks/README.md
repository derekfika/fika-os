# Munich RE Hot Drink Tally

## Assumptions

- The Apps Script project is either bound to the Google Sheet that will store the tally data, or `setHotDrinkSpreadsheetId("SHEET_URL_OR_ID")` is run once.
- The web app is deployed as the deploying user and can be accessed anonymously from the bar tablet.
- The barista view is designed for a landscape tablet and shows a rotate prompt in portrait orientation.
- Android browsers cannot be forced into fullscreen from a normal tab. For the most fullscreen-like mode, open the deployed URL in Chrome and use “Add to Home screen”, then launch it from the new home-screen icon.
- Reporting is deployed separately from `../munich-hot-drinks-reporting` and connected to the same spreadsheet.
- User email is only captured when Google allows it; otherwise the app stores a device/browser label.
- Undo marks the latest active row as `UNDONE` and writes an audit entry, preserving the original row.
- Test data clearing only removes rows whose `Source` or `Device/User` contains `TEST`.

## Files

- `Code.gs` serves the tally web app, menu, setup and public config.
- `Config.gs` contains sheet names, headers, floors, drinks and heatmap buckets.
- `SheetService.gs` records tap batches, handles undo, counts today and writes audit rows.
- `ArchiveService.gs` archives completed days to Drive JSON and installs the nightly archive trigger.
- `Reporting.gs` is included only for shared setup compatibility; deploy reporting from the separate reporting app folder.
- `Index.html`, `Styles.html`, and `JavaScript.html` contain the tablet tally screen.

## Deploy

1. Create a Google Sheet for Munich RE hot drinks.
2. Open Extensions > Apps Script.
3. Add these files to the Apps Script project.
4. Run `setupHotDrinkTally` once and approve permissions.
5. Run `installNightlyArchiveTrigger` once to archive completed days to Drive at 02:00 daily.
6. Deploy > New deployment > Web app.
7. Set “Execute as” to “Me”.
8. Set access to the audience needed for the tablets.
9. Open the tally deployment URL on the Android tablet and use Chrome “Add to Home screen”, then launch from the home-screen icon for standalone/fullscreen-friendly mode.

Deploy the reporting dashboard separately from `munich-hot-drinks-reporting`. Run `setHotDrinkSpreadsheetId("SHEET_URL_OR_ID")` in that project too if it is not bound to the same Sheet.

## Sheet Tabs

The setup function creates:

- `Drink_Log`
- `Settings`
- `Dashboard_Data`
- `Audit_Log`

The tally screen prioritises speed: taps are saved immediately to a local browser queue, visible counters update instantly, and the app syncs batches to Sheets in the background every minute or sooner during a rush. If sync fails, queued taps stay on the tablet and retry automatically.

Completed days can be archived from `Drink_Log` into Drive JSON files by running `archiveCompletedDrinkLogDays` manually or installing the nightly trigger. Reporting reads both live Sheet rows and archived JSON rows.

If the tally and reporting apps are separate Apps Script projects, use `getHotDrinkArchiveFolderId()` in the app that installs the archive trigger, then run `setHotDrinkArchiveFolderId("FOLDER_ID")` in the other app so both projects read the same archive folder.
