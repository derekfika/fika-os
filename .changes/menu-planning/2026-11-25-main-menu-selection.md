# 2026-11-25 — Keep Main menu available alongside additional menus

Week Planner keeps the original Main menu in each weekday selector alongside the applicable one-off and recurring services. A selected breakfast stays selected on reload, and switching back opens the original weekly menu. Cached snapshots check the selected week's menu summaries by date so newly added choices can appear independently of the selected menu's content version.

Validation: 60 focused tests passed. Menu Planning suite passed 589 tests with four emulator-dependent skips. Typecheck and production build passed. An isolated Chromium fixture covered Monday Munich RE, Friday Wise, a second Monday menu, switching back to Main and reloading. Hosted acceptance and downstream publication remain pending.

Deployment: none.
