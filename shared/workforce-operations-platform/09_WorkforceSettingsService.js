function getWorkforceSettingsData() {
  const spreadsheet = getWorkforceSpreadsheet_();
  return {
    ok: true,
    managers: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.managers)),
    agencyContacts: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyContacts)),
    roles: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.roleLibrary)),
    shiftPatterns: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.shiftPatterns)),
    sites: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.sites)),
    staff: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory))
      .filter(function(person) {
        return String(person.Name || "").trim() &&
          String(person["Employment Status"] || "").toLowerCase() !== "terminated" &&
          !workforceBoolean_(person.Terminated);
      })
      .map(function(person) {
        return {
          employeeId: person["Employee ID"],
          name: person.Name,
          email: person.Email,
          role: person.Role,
          reliefTeam: workforceBoolean_(person["Relief Team"])
        };
      }),
    rotaTemplates: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates)),
    personStandardRota: readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.personStandardRota))
  };
}

function saveWorkforceManager(manager) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const name = String(manager.managerName || manager["Manager Name"] || "").trim();
  const email = String(manager.email || manager.Email || "").trim();
  if (!name) throw new Error("Manager name is required.");
  if (!isWorkforceEmail_(email)) throw new Error("Enter a valid manager email.");
  const id = "manager_" + slugifyWorkforce_(name);
  upsertWorkforceRows_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.managers), "Manager ID", [{
    "Manager ID": id,
    "Manager Name": name,
    "Email": email,
    "Phone": manager.phone || "",
    "Primary Site ID": manager.primarySiteId || "",
    "Secondary Site IDs": manager.secondarySiteIds || "",
    "Receives Gap Alerts": true,
    "Receives Agency Confirmations": true,
    "Active": true,
    "Notes": manager.notes || ""
  }]);
  return { ok: true, managerId: id, message: "Manager saved." };
}

function saveWorkforceAgencyContact(contact) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const agencyName = String(contact.agencyName || contact["Agency Name"] || "").trim();
  const email = String(contact.email || contact.Email || "").trim();
  if (!agencyName) throw new Error("Agency name is required.");
  if (!isWorkforceEmail_(email)) throw new Error("Enter a valid agency email.");
  const id = "agency_" + slugifyWorkforce_(agencyName);
  upsertWorkforceRows_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyContacts), "Agency ID", [{
    "Agency ID": id,
    "Agency Name": agencyName,
    "Contact Name": contact.contactName || "",
    "Email": email,
    "Phone": contact.phone || "",
    "Roles Supplied": contact.rolesSupplied || "",
    "Sites Covered": contact.sitesCovered || "",
    "Default Rate": contact.defaultRate || "",
    "Active": true,
    "Notes": contact.notes || ""
  }]);
  return { ok: true, agencyId: id, message: "Agency contact saved." };
}

function setWorkforceReliefTeamMember(employeeId, employeeName, isReliefTeam) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory);
  const map = workforceHeaderMap_(sheet);
  const reliefColumn = map["Relief Team"];
  if (!reliefColumn) throw new Error("Staff Directory is missing Relief Team column.");
  const idColumn = map["Employee ID"];
  const nameColumn = map.Name;
  if (!idColumn && !nameColumn) throw new Error("Staff Directory is missing employee identifiers.");
  const targetId = String(employeeId || "").trim();
  const targetName = normaliseWorkforcePerson_(employeeName);
  if (!targetId && !targetName) throw new Error("Choose a staff member first.");
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowId = idColumn ? String(row[idColumn - 1] || "").trim() : "";
    const rowName = nameColumn ? normaliseWorkforcePerson_(row[nameColumn - 1]) : "";
    if ((targetId && rowId === targetId) || (!targetId && targetName && rowName === targetName)) {
      sheet.getRange(index + 2, reliefColumn).setValue(Boolean(isReliefTeam));
      return {
        ok: true,
        employeeId: rowId,
        employeeName: row[nameColumn - 1] || employeeName,
        reliefTeam: Boolean(isReliefTeam),
        message: (row[nameColumn - 1] || employeeName) + (isReliefTeam ? " added to relief team." : " removed from relief team.")
      };
    }
  }
  throw new Error("Staff member was not found.");
}

function saveWorkforceRotaTemplate(template) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const siteId = String(template.siteId || template["Site ID"] || "").trim();
  const siteName = String(template.siteName || template["Site Name"] || "").trim() ||
    getWorkforceSiteName_(spreadsheet, siteId);
  const weekday = String(template.weekday || template.Weekday || "").trim();
  const role = String(template.role || template.Role || "").trim();
  const employeeName = String(template.employeeName || template["Employee Name"] || "").trim();
  const standardStatus = String(template.standardStatus || template["Standard Status"] || "IN").trim() || "IN";
  if (!siteId) throw new Error("Choose a site for this rota template.");
  if (!weekday) throw new Error("Choose a weekday for this rota template.");
  if (!role) throw new Error("Role is required.");
  if (!employeeName && standardStatus.toUpperCase() === "IN") {
    throw new Error("Employee name is required for an IN rota row.");
  }
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates);
  const row = {
    "Site ID": siteId,
    "Site Name": siteName || siteId,
    "Weekday": weekday,
    "Role": role,
    "Employee Name": employeeName,
    "Standard Status": standardStatus
  };
  const existingId = findExistingRotaTemplateId_(sheet, row);
  const id = existingId || [
    "template",
    siteId,
    weekday,
    slugifyWorkforce_(role),
    slugifyWorkforce_(employeeName || standardStatus)
  ].join("_");
  upsertWorkforceRows_(sheet, "Template ID", [{
    "Template ID": id,
    "Site ID": siteId,
    "Site Name": siteName || siteId,
    "Weekday": weekday,
    "Role": role,
    "Employee Name": employeeName,
    "Standard Status": standardStatus,
    "Source": "Web App",
    "Observations": template.notes || "",
    "Active": true
  }]);
  const duplicatesDeactivated = deactivateDuplicateRotaTemplatesForKey_(sheet, row, id);
  return {
    ok: true,
    templateId: id,
    duplicatesDeactivated: duplicatesDeactivated,
    message: duplicatesDeactivated
      ? "Standard rota row saved. " + duplicatesDeactivated + " duplicate row(s) were disabled."
      : "Standard rota row saved."
  };
}

function dedupeWorkforceRotaTemplates() {
  const spreadsheet = getWorkforceSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates);
  if (!sheet || sheet.getLastRow() < 3) {
    return { ok: true, duplicatesDeactivated: 0, message: "No duplicate rota templates found." };
  }
  const templates = readWorkforceObjects_(sheet);
  const keepByKey = {};
  let disabled = 0;
  templates.forEach(function(template) {
    if (!workforceBoolean_(template.Active)) return;
    const key = getRotaTemplateDuplicateKey_(template);
    if (!key) return;
    const keep = keepByKey[key];
    if (!keep) {
      keepByKey[key] = template;
      return;
    }
    const currentIsWeb = String(template.Source || "") === "Web App";
    const keepIsWeb = String(keep.Source || "") === "Web App";
    if (currentIsWeb && !keepIsWeb) {
      disabled += setRotaTemplateActive_(sheet, keep["Template ID"], false, "Disabled duplicate; kept " + template["Template ID"]);
      keepByKey[key] = template;
    } else {
      disabled += setRotaTemplateActive_(sheet, template["Template ID"], false, "Disabled duplicate; kept " + keep["Template ID"]);
    }
  });
  return {
    ok: true,
    duplicatesDeactivated: disabled,
    message: disabled
      ? disabled + " duplicate rota template row(s) disabled."
      : "No duplicate rota templates found."
  };
}

function findExistingRotaTemplateId_(sheet, template) {
  const targetKey = getRotaTemplateDuplicateKey_(template);
  if (!targetKey) return "";
  return readWorkforceObjects_(sheet)
    .filter(function(row) {
      return workforceBoolean_(row.Active) &&
        getRotaTemplateDuplicateKey_(row) === targetKey;
    })
    .map(function(row) { return String(row["Template ID"] || ""); })[0] || "";
}

function deactivateDuplicateRotaTemplatesForKey_(sheet, template, keepId) {
  const targetKey = getRotaTemplateDuplicateKey_(template);
  if (!targetKey || !keepId) return 0;
  let disabled = 0;
  readWorkforceObjects_(sheet).forEach(function(row) {
    const id = String(row["Template ID"] || "");
    if (id && id !== keepId && workforceBoolean_(row.Active) && getRotaTemplateDuplicateKey_(row) === targetKey) {
      disabled += setRotaTemplateActive_(sheet, id, false, "Disabled duplicate; kept " + keepId);
    }
  });
  return disabled;
}

function setRotaTemplateActive_(sheet, templateId, active, note) {
  if (!sheet || !templateId) return 0;
  const map = workforceHeaderMap_(sheet);
  const idColumn = map["Template ID"];
  if (!idColumn || !map.Active) return 0;
  const ids = sheet.getLastRow() > 1
    ? sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getDisplayValues()
    : [];
  for (let index = 0; index < ids.length; index++) {
    if (String(ids[index][0] || "") === String(templateId)) {
      const rowNumber = index + 2;
      sheet.getRange(rowNumber, map.Active).setValue(active);
      if (map.Observations && note) {
        const existing = String(sheet.getRange(rowNumber, map.Observations).getDisplayValue() || "");
        sheet.getRange(rowNumber, map.Observations).setValue([existing, note].filter(Boolean).join("\n"));
      }
      return 1;
    }
  }
  return 0;
}

function getWorkforceSiteName_(spreadsheet, siteId) {
  const cleanSiteId = String(siteId || "");
  const site = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.sites))
    .filter(function(row) {
      return String(row["Site ID"] || "") === cleanSiteId;
    })[0];
  return site ? String(site["Site Name"] || "") : "";
}

function isWorkforceEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
