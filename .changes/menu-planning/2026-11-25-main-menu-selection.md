# 2026-11-25 — Keep Main menu available alongside additional menus

Week Planner keeps the original Main menu in each weekday selector alongside the applicable one-off and recurring services. A selected breakfast stays selected on reload, and switching back opens the original weekly menu. Cached snapshots check the selected week's menu summaries by date so newly added choices can appear independently of the selected menu's content version.

Week summaries include supplementary menus only at permitted sites and omit kitchen notes for every role. A detail request can return notes to a manager authorised to edit the entire service. Site-scoped readers receive only their permitted site IDs and labels. A revised cache scope prevents prior presentations from being reused after the correction or a change in editing grants.

Validation: 47 focused API, access, selection and read-path tests passed, including site-scoped viewers, a historical site alias and an organisation manager. Typecheck passed. The preceding selector revision also passed 60 focused tests, 589 Menu Planning tests (four skipped), a production build and an isolated Chromium check covering Munich RE, Wise, a second Monday menu, switching back to Main and reloading. Hosted acceptance and downstream publication remain pending.

Deployment: none.
