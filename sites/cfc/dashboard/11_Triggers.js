function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Hospitality Dashboard")
      .addItem("Initialise settings", "initialiseDashboardSettings")
      .addItem("Import settings draft", "importDashboardSettingsDraft")
      .addItem("Create hourly inbox scan", "createDashboardScanTrigger")
      .addItem("Remove inbox scan triggers", "deleteDashboardScanTriggers")
      .addToUi();
  } catch (e) {
    Logger.log("Dashboard menu could not be created: " + e);
  }
}

function initialiseDashboardSettings() {
  ensureSettingsDefaults_();

  return {
    ok: true,
    message: "Dashboard settings initialised."
  };
}

function createDashboardScanTrigger() {
  const fn = "scanInboxForDashboardBookings";

  const exists = ScriptApp
    .getProjectTriggers()
    .some(t => t.getHandlerFunction() === fn);

  if (exists) {
    return { ok: true, message: "Scan trigger already exists." };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyHours(1)
    .create();

  return { ok: true, message: "Hourly scan trigger created." };
}

function deleteDashboardScanTriggers() {
  const fn = "scanInboxForDashboardBookings";

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fn)
    .forEach(t => ScriptApp.deleteTrigger(t));

  return { ok: true, message: "Scan triggers removed." };
}
