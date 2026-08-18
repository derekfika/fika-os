# FIKA Release Manager

Open `Release Manager.bat` in the workspace root to launch the Windows interface. You can also use `Launch Release Manager.bat` in this folder. These launchers apply an execution-policy bypass only to this invocation; they do not change the computer's PowerShell security policy.

Do not launch `ReleaseManager.ps1` directly on a computer where PowerShell script execution is disabled.

The manager can create and link a new standalone Apps Script project, then run these actions for one or more selected projects:

- push local files to Apps Script;
- update an existing web-app deployment;
- stage and commit only the selected project folders;
- push the current Git branch.

Nothing runs until the final confirmation dialog is accepted. The activity log shows each command and stops the release if any command fails. Git actions are skipped after an Apps Script failure.

Use **Edit selected** or **Add project** in the window to manage project names, folders, Script IDs, deployment IDs and clasp usernames. For a new project, leave the Script ID blank, save it, then select its row and choose **Create Apps Script**. Script IDs are written to each project's `.clasp.json`; the remaining release settings are stored in `projects.json`.

Use **Login one profile** to enter a named clasp account alias and start Google authorization in the browser. Use **Login all profiles** to authorize every distinct username used by configured projects in one guided sequence. The manager passes the named profile as a global clasp option before the login command, which is required by clasp 3.x. Google passwords are never requested or stored by the manager; clasp stores its renewable OAuth credentials in the normal user credential file.

A project with a blank deployment ID receives a first web-app deployment automatically. The manager captures and saves the new deployment ID. Later releases use clasp's redeploy command so the same public URL is preserved.

The list is checked against linked `.clasp.json` projects when the manager opens. Newly linked projects appear automatically as unconfigured entries so they cannot be silently missed.
