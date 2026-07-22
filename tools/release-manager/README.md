# FIKA Release Manager

Open `Release Manager.bat` in the workspace root to launch the Windows interface. You can also use `Launch Release Manager.bat` in this folder. These launchers apply an execution-policy bypass only to this invocation; they do not change the computer's PowerShell security policy.

Do not launch `ReleaseManager.ps1` directly on a computer where PowerShell script execution is disabled.

The manager can run these actions for one or more selected Apps Script projects:

- push local files to Apps Script;
- update an existing web-app deployment;
- stage and commit only the selected project folders;
- push the current Git branch.

Nothing runs until the final confirmation dialog is accepted. The activity log shows each command and stops the release if any command fails. Git actions are skipped after an Apps Script failure.

Use **Edit selected** or **Add project** in the window to manage project names, folders, Script IDs, deployment IDs and clasp usernames. Script IDs are written to each project's `.clasp.json`; the remaining release settings are stored in `projects.json`.

Use **Login one profile** to enter a named clasp account alias and start Google authorization in the browser. Use **Login all profiles** to authorize every distinct username used by configured projects in one guided sequence. The manager runs `npx --yes @google/clasp login --user <alias>` when a global clasp command is unavailable. Google passwords are never requested or stored by the manager; clasp stores its renewable OAuth credentials in the normal user credential file.

A project with a blank deployment ID can still be pushed to Apps Script and included in Git, but deployment is skipped with a warning until the ID is added.

The list is checked against linked `.clasp.json` projects when the manager opens. Newly linked projects appear automatically as unconfigured entries so they cannot be silently missed.
