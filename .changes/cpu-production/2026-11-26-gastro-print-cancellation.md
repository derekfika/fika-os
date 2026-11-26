# 2026-11-26 — Cancel pending Gastro Label print previews

Closing the Gastro Labels dialog while CPU checks the current production day closes the preparation window. A delayed response cannot print or disturb a later attempt. This also applies when the operator presses Escape or navigates away.

Validation: All 23 CPU print tests, all 10 Gastro Label helper tests and CPU typecheck passed. The headless browser regression intercepted print calls and exercised Cancel, Escape, navigation away and reopening after a delayed response.

Deployment: none.
