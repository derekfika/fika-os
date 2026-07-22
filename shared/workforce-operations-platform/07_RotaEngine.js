function getRotaAppOptions() {
  const spreadsheet = getWorkforceSpreadsheet_();
  const sites = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.sites)
  ).filter(function(site) {
    return site["Site ID"] && String(site.Active).toUpperCase() !== "FALSE";
  }).map(function(site) {
    return {
      siteId: String(site["Site ID"]),
      siteName: String(site["Site Name"] || site["Site ID"])
    };
  }).sort(function(a, b) {
    return a.siteName.localeCompare(b.siteName);
  });
  return {
    ok: true,
    sites: sites,
    defaultWeekStart: getNextMonday_()
  };
}

function getWeeklyRotaBoard(siteId, weekStartDate) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const cleanSiteId = String(siteId || "").trim();
  if (!cleanSiteId) throw new Error("Choose a site first.");
  const weekStart = normaliseWeekStart_(weekStartDate);
  const weekDates = getWeekDates_(weekStart);
  const templates = uniqueWorkforceRotaTemplates_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates)
  ).filter(function(template) {
    return String(template["Site ID"] || "") === cleanSiteId &&
      workforceBoolean_(template.Active);
  }));
  if (!templates.length) {
    return {
      ok: true,
      siteId: cleanSiteId,
      siteName: cleanSiteId,
      weekStart: weekStart,
      days: [],
      totalRows: 0,
      totalGaps: 0,
      message: "No standard rota templates found for this site."
    };
  }
  const absences = buildAbsenceIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.absences)
  ));
  const rotaExceptions = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaExceptions)
  );
  const exceptions = buildRotaExceptionIndex_(rotaExceptions);
  const coverIndex = buildRotaCoverIndex_(rotaExceptions);
  const gapsByKey = buildCoverageGapIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps)
  ));

  const siteName = (templates[0] && templates[0]["Site Name"]) || cleanSiteId;
  const days = weekDates.map(function(day) {
    const rows = templates
      .filter(function(template) {
        return String(template.Weekday || "") === day.weekday &&
          String(template["Standard Status"] || "").toUpperCase() !== "OFF";
      })
      .map(function(template) {
        const person = String(template["Employee Name"] || "").trim();
        const exception = exceptions[getGapTemplateDateKey_(template, day.date)];
        const cover = coverIndex[getCoverDateRoleKey_(template["Site ID"], day.date, template.Role)];
        const absence = absences[getGapPersonDateKey_(person, day.date)];
        const gap = gapsByKey[getGapTemplateDateKey_(template, day.date)];
        const status = exception
          ? String(exception["Actual Status"] || exception["Exception Type"] || "Exception")
          : cover && absence
            ? "Covered"
          : absence
            ? String(absence["Absence Type"] || "Absent")
            : String(template["Standard Status"] || "IN");
        return {
          role: String(template.Role || ""),
          employeeName: person,
          standardStatus: String(template["Standard Status"] || ""),
          status: status,
          exceptionType: exception ? String(exception["Exception Type"] || "") : "",
          gapType: gap ? String(gap["Gap Type"] || "") : "",
          coverName: cover ? String(cover["Employee Name"] || "") : "",
          coverType: cover ? String(cover["Exception Type"] || "Cover") : "",
          hasGap: Boolean((gap || absence || (exception && !isGapClearedByException_(exception))) && !cover),
          priority: gap ? Number(gap.Priority || 3) : getGapPriority_(template.Role),
          notes: exception ? String(exception.Notes || "") : ""
        };
      })
      .sort(function(a, b) {
        return a.priority - b.priority || a.role.localeCompare(b.role);
      });
    return {
      date: day.date,
      weekday: day.weekday,
      rows: rows,
      gapCount: rows.filter(function(row) { return row.hasGap; }).length
    };
  });

  return {
    ok: true,
    siteId: cleanSiteId,
    siteName: siteName,
    weekStart: weekStart,
    days: days,
    totalRows: days.reduce(function(total, day) { return total + day.rows.length; }, 0),
    totalGaps: days.reduce(function(total, day) { return total + day.gapCount; }, 0)
  };
}

function generateReliefSuggestions(daysAhead) {
  detectCoverageGaps(daysAhead || 28);
  const spreadsheet = getWorkforceSpreadsheet_();
  const gaps = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps)
  ).filter(function(gap) {
    return String(gap.Status || "").toLowerCase() !== "resolved";
  });
  const absences = buildAbsenceIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.absences)
  ));
  const reliefAvailability = buildReliefAvailabilityIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.reliefAvailability)
  ));
  const coverHistory = buildCoverHistoryIndex_(readCoverHistoryRows_(spreadsheet));
  const staff = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory)
  ).filter(function(person) {
    return isReliefCandidate_(person, reliefAvailability);
  });
  const suggestions = [];

  gaps.forEach(function(gap) {
    const availableRelief = reliefAvailability[normaliseWorkforceDate_(gap.Date)] || [];
    const candidates = staff
      .filter(function(person) {
        return String(person.Name || "") &&
          normaliseWorkforcePerson_(person.Name) !== normaliseWorkforcePerson_(gap["Employee Name"]) &&
          !absences[getGapPersonDateKey_(person.Name, normaliseWorkforceDate_(gap.Date))];
      })
      .map(function(person) {
        const reliefMatch = findReliefAvailabilityForPerson_(availableRelief, person.Name);
        const historySignal = getCoverHistorySignal_(coverHistory, gap, person);
        return {
          person: person,
          reliefMatch: reliefMatch,
          historySignal: historySignal,
          score: scoreReliefCandidate_(person, gap, historySignal) +
            (reliefMatch ? 60 : 0)
        };
      })
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, 3);
    candidates.forEach(function(candidate, index) {
      const id = [
        "relief",
        gap["Gap ID"],
        slugifyWorkforce_(candidate.person.Name),
        index + 1
      ].join("_");
      suggestions.push({
        "Suggestion ID": id,
        "Gap ID": gap["Gap ID"],
        "Site ID": gap["Site ID"],
        "Date": normaliseWorkforceDate_(gap.Date),
        "Role": gap.Role,
          "Suggested Employee ID": candidate.person["Employee ID"],
          "Suggested Employee Name": candidate.person.Name,
          "Reason": buildReliefReason_(candidate.person, gap, candidate.reliefMatch, candidate.historySignal),
        "Score": candidate.score,
        "Reviewed": false,
        "Approved": false
      });
    });
  });

  const sheet = ensureReliefSuggestionsSheet_(spreadsheet);
  replaceWorkforceSheetRowsFast_(sheet, suggestions);
  return {
    ok: true,
    gapsReviewed: gaps.length,
    suggestionsCreated: suggestions.length
  };
}

function isReliefCandidate_(person, reliefAvailability) {
  if (String(person["Employment Status"] || "").toLowerCase() === "terminated") return false;
  if (workforceBoolean_(person.Terminated)) return false;
  if (workforceBoolean_(person["Relief Team"])) return true;
  const personName = normaliseWorkforcePerson_(person.Name);
  return Object.keys(reliefAvailability || {}).some(function(date) {
    return (reliefAvailability[date] || []).some(function(row) {
      return normaliseWorkforcePerson_(row["Relief Name"]) === personName;
    });
  });
}

function getReliefSuggestionSummary(limit) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const suggestions = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.reliefSuggestions)
  ).sort(function(a, b) {
    return String(a.Date || "").localeCompare(String(b.Date || "")) ||
      Number(b.Score || 0) - Number(a.Score || 0);
  });
  return {
    ok: true,
    count: suggestions.length,
    suggestions: suggestions.slice(0, Math.max(1, Number(limit || 12)))
  };
}

function generateReliefRotaAssignments(daysAhead) {
  const suggestionResult = generateReliefSuggestions(daysAhead || 28);
  const spreadsheet = getWorkforceSpreadsheet_();
  const gapsById = {};
  readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps))
    .filter(function(gap) {
      return String(gap.Status || "").toLowerCase() !== "resolved";
    })
    .forEach(function(gap) {
      gapsById[String(gap["Gap ID"] || "")] = gap;
    });
  const suggestions = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.reliefSuggestions)
  ).sort(function(a, b) {
    return String(a.Date || "").localeCompare(String(b.Date || "")) ||
      Number(b.Score || 0) - Number(a.Score || 0);
  });
  const staffByName = {};
  readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory))
    .forEach(function(person) {
      staffByName[normaliseWorkforcePerson_(person.Name)] = person;
    });
  const usedByDate = {};
  const assignedGaps = {};
  const now = new Date();
  const assignments = [];
  suggestions.forEach(function(suggestion) {
    const gapId = String(suggestion["Gap ID"] || "");
    const gap = gapsById[gapId];
    if (!gap || assignedGaps[gapId]) return;
    const date = normaliseWorkforceDate_(suggestion.Date);
    const personName = String(suggestion["Suggested Employee Name"] || "");
    const personKey = normaliseWorkforcePerson_(personName);
    const datePersonKey = date + "|" + personKey;
    if (usedByDate[datePersonKey]) return;
    const person = staffByName[personKey] || {};
    usedByDate[datePersonKey] = true;
    assignedGaps[gapId] = true;
    assignments.push({
      "Assignment ID": "relief_assignment_" + gapId + "_" + slugifyWorkforce_(personName),
      "Gap ID": gapId,
      "Site ID": gap["Site ID"],
      "Site Name": gap["Site Name"],
      "Date": date,
      "Weekday": gap.Weekday,
      "Role": gap.Role,
      "Covering Employee ID": person["Employee ID"] || suggestion["Suggested Employee ID"],
      "Covering Employee Name": personName,
      "Covering Email": person.Email || "",
      "Covered Employee Name": gap["Employee Name"],
      "Status": "Draft",
      "Score": suggestion.Score,
      "Reason": suggestion.Reason,
      "Generated At": now,
      "Notes": "Generated from relief rota engine"
    });
  });
  const sheet = ensureReliefAssignmentsSheet_(spreadsheet);
  replaceWorkforceSheetRowsFast_(sheet, assignments);
  return {
    ok: true,
    suggestionsCreated: suggestionResult.suggestionsCreated,
    assignmentsCreated: assignments.length,
    message: assignments.length + " draft relief assignment(s) generated."
  };
}

function generateReliefRotaPdfForWeek_(siteId, weekStartDate) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const weekStart = normaliseWeekStart_(weekStartDate);
  const weekDates = getWeekDates_(weekStart).filter(function(day) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].indexOf(day.weekday) !== -1;
  });
  const dateSet = {};
  weekDates.forEach(function(day) { dateSet[day.date] = true; });

  const gapsById = {};
  readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps))
    .filter(function(gap) {
      const date = normaliseWorkforceDate_(gap.Date);
      return dateSet[date] && String(gap.Status || "").toLowerCase() !== "resolved";
    })
    .forEach(function(gap) {
      if (gap["Gap ID"]) gapsById[String(gap["Gap ID"])] = gap;
    });

  const suggestions = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.reliefSuggestions)
  ).filter(function(suggestion) {
    return dateSet[normaliseWorkforceDate_(suggestion.Date)] &&
      String(suggestion.Approved || "").toUpperCase() !== "TRUE";
  }).sort(function(a, b) {
    return String(a.Date || "").localeCompare(String(b.Date || "")) ||
      Number(b.Score || 0) - Number(a.Score || 0);
  });

  const staffByName = {};
  readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory))
    .forEach(function(person) {
      staffByName[normaliseWorkforcePerson_(person.Name)] = person;
    });

  const usedByDate = {};
  const assignedGaps = {};
  const now = new Date();
  const assignments = [];
  suggestions.forEach(function(suggestion) {
    const gapId = String(suggestion["Gap ID"] || "");
    const gap = gapsById[gapId] || {};
    if (!gapId || assignedGaps[gapId]) return;
    const date = normaliseWorkforceDate_(suggestion.Date);
    const personName = String(suggestion["Suggested Employee Name"] || "");
    const personKey = normaliseWorkforcePerson_(personName);
    const datePersonKey = date + "|" + personKey;
    if (usedByDate[datePersonKey]) return;
    const person = staffByName[personKey] || {};
    usedByDate[datePersonKey] = true;
    assignedGaps[gapId] = true;
    assignments.push({
      "Assignment ID": "relief_assignment_" + gapId + "_" + slugifyWorkforce_(personName),
      "Gap ID": gapId,
      "Site ID": gap["Site ID"] || suggestion["Site ID"] || "",
      "Site Name": gap["Site Name"] || suggestion["Site Name"] || "",
      "Date": date,
      "Weekday": gap.weekday || gap.Weekday || getWorkforceWeekday_(new Date(date + "T00:00:00")),
      "Role": gap.role || gap.Role || suggestion.Role,
      "Covering Employee ID": person["Employee ID"] || suggestion["Suggested Employee ID"],
      "Covering Employee Name": personName,
      "Covering Email": person.Email || "",
      "Covered Employee Name": gap.missingEmployeeName || gap.employeeName || gap["Employee Name"] || "",
      "Status": "Draft",
      "Score": suggestion.Score,
      "Reason": suggestion.Reason,
      "Generated At": now,
      "Notes": "Generated from selected week rota cockpit"
    });
  });

  if (assignments.length) {
    upsertWorkforceRows_(ensureReliefAssignmentsSheet_(spreadsheet), "Assignment ID", assignments);
  }

  const filename = [
    "FIKA relief rota",
    "WC " + weekStart
  ].join(" - ") + ".pdf";
  const reliefRota = buildReliefRotaWindow_("__all_sites", weekStart);
  const pdf = buildReliefTeamRotaPdfBlob_(reliefRota, filename);
  return {
    ok: true,
    siteId: "__all_sites",
    siteName: "All sites",
    weekStart: weekStart,
    weekEnd: weekDates.length ? weekDates[weekDates.length - 1].date : weekStart,
    assignmentsCreated: assignments.length,
    filename: filename,
    mimeType: "application/pdf",
    base64: Utilities.base64Encode(pdf.getBytes()),
    message: assignments.length
      ? assignments.length + " relief assignment(s) generated for the selected week."
      : "No relief assignments were needed for the selected week."
  };
}

function buildReliefTeamRotaPdfBlob_(reliefRota, filename) {
  const days = reliefRota.days || [];
  const people = reliefRota.people || [];
  const totals = reliefRota.totals || {};
  const colours = ["#b7b7b7", "#ff9900", "#a64d79", "#ff00ff", "#0000ff", "#f4b400", "#cc3a22", "#009688", "#674ea7"];
  const html = [
    "<html><head><style>",
    "@page{size:A4 landscape;margin:12mm}",
    "body{font-family:Arial,sans-serif;color:#111;margin:0;background:#fff}",
    ".title{background:#4b2cc9;color:#fff;text-align:center;font-size:28px;font-weight:900;padding:8px 10px;margin-bottom:12px}",
    ".meta{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;color:#4b2cc9;font-size:12px;font-weight:800}",
    "table{width:100%;border-collapse:collapse;table-layout:fixed}",
    "th,td{border:1px solid #222;padding:4px 5px;font-size:10.5px;vertical-align:top;word-wrap:break-word}",
    "thead th{background:#4b2cc9;color:#fff;font-size:13px;font-weight:900;text-align:center}",
    ".label{width:78px;background:#4b2cc9;color:#fff;text-align:left;font-weight:900}",
    ".ot{width:48px;background:#4b2cc9;color:#fff;text-align:center;font-size:24px;font-weight:900}",
    ".person td{color:#fff;text-align:center;font-weight:900;font-size:13px;padding:3px 5px;border-color:#222}",
    ".row-label{background:#f1f1f1;color:#111;font-weight:900;width:78px}",
    ".site{font-weight:800}",
    ".shift{font-size:9.5px;color:#333;margin-top:3px}",
    ".covered{font-size:9px;color:#4b2cc9;font-weight:800;margin-top:3px}",
    ".reason{font-size:8.5px;color:#555;margin-top:3px}",
    ".empty{background:#fff;color:#bbb}",
    "hr{border:0;border-top:1px solid #ddd;margin:5px 0}",
    ".summary{margin-top:10px;font-size:10px;color:#555}",
    "</style></head><body>",
    "<div class='title'>FIKA Relief Team Rota</div>",
    "<div class='meta'><span>All sites</span><span>Week commencing " + escapeHtmlForPdf_(reliefRota.weekStart || "") + "</span><span>" + String(totals.assignments || 0) + " assignment(s)</span></div>",
    "<table><thead><tr><th class='label'>Day</th>"
  ];
  days.forEach(function(day) {
    html.push("<th>" + escapeHtmlForPdf_(day.weekday) + "</th>");
  });
  html.push("<th class='ot'>OT</th></tr><tr><th class='label'>Date</th>");
  days.forEach(function(day) {
    html.push("<th>" + escapeHtmlForPdf_(formatPdfDate_(day.date)) + "</th>");
  });
  html.push("<th class='ot'>OT</th></tr></thead><tbody>");
  if (!people.length) {
    html.push("<tr><td class='row-label'>Site</td><td colspan='" + String(days.length + 1) + "' class='empty'>No relief cover recorded for this selected week.</td></tr>");
  }
  people.forEach(function(person, index) {
    const colour = colours[index % colours.length];
    html.push("<tr class='person'><td colspan='" + String(days.length + 2) + "' style='background:" + colour + "'>" + escapeHtmlForPdf_(person.employeeName || "Unassigned relief") + "</td></tr>");
    html.push("<tr><td class='row-label'>Site<br>Shift</td>");
    days.forEach(function(day) {
      const rows = (person.assignmentsByDate && person.assignmentsByDate[day.date]) || [];
      if (!rows.length) {
        html.push("<td class='empty'>&nbsp;</td>");
        return;
      }
      html.push("<td>" + rows.map(function(row) {
        return "<div class='site'>" + escapeHtmlForPdf_(row.siteName || row.siteId || "") +
          (row.role ? " - " + escapeHtmlForPdf_(row.role) : "") + "</div>" +
          "<div class='shift'>Covering " + escapeHtmlForPdf_(row.coveredEmployeeName || "rota gap") + "</div>" +
          "<div class='covered'>" + escapeHtmlForPdf_(row.status || "Draft") + "</div>" +
          (row.reason ? "<div class='reason'>" + escapeHtmlForPdf_(row.reason) + "</div>" : "");
      }).join("<hr>") + "</td>");
    });
    html.push("<td class='empty'>&nbsp;</td></tr>");
  });
  html.push("</tbody></table><div class='summary'>Generated from Workforce Operations. Draft relief assignments are subject to manager confirmation.</div></body></html>");
  return Utilities.newBlob(html.join(""), "text/html", filename.replace(/\.pdf$/i, ".html"))
    .getAs("application/pdf")
    .setName(filename);
}

function buildReliefRotaPdfBlob_(cockpit, assignments, weekDates, filename) {
  const assignmentsByPerson = {};
  const personOrder = [];
  (assignments || []).forEach(function(row) {
    const person = String(row["Covering Employee Name"] || "Unassigned relief").trim();
    if (!assignmentsByPerson[person]) {
      assignmentsByPerson[person] = {};
      personOrder.push(person);
    }
    const date = normaliseWorkforceDate_(row.Date);
    if (!assignmentsByPerson[person][date]) assignmentsByPerson[person][date] = [];
    assignmentsByPerson[person][date].push(row);
  });
  const colours = ["#b7b7b7", "#ff9900", "#a64d79", "#ff00ff", "#0000ff", "#f4b400", "#cc3a22", "#009688", "#674ea7"];
  const weekRows = weekDates || [];
  const html = [
    "<html><head><style>",
    "@page{size:A4 landscape;margin:14mm}",
    "body{font-family:Arial,sans-serif;color:#111;margin:0;background:#fff}",
    ".title{background:#4b2cc9;color:#fff;text-align:center;font-size:26px;font-weight:800;padding:8px 10px;margin-bottom:14px}",
    ".meta{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;color:#4b2cc9;font-size:12px;font-weight:700}",
    "table{width:100%;border-collapse:collapse;table-layout:fixed}",
    "th,td{border:1px solid #222;padding:4px 5px;font-size:10.5px;vertical-align:top;word-wrap:break-word}",
    "thead th{background:#4b2cc9;color:#fff;font-size:13px;font-weight:800;text-align:center}",
    ".label{width:74px;background:#4b2cc9;color:#fff;text-align:left;font-weight:800}",
    ".ot{width:54px;background:#4b2cc9;color:#fff;text-align:center;font-size:24px;font-weight:900}",
    ".person td{color:#fff;text-align:center;font-weight:900;font-size:13px;padding:3px 5px;border-color:#222}",
    ".row-label{background:#f1f1f1;color:#111;font-weight:800;width:74px}",
    ".site{font-weight:700}",
    ".shift{font-size:9.5px;color:#333;margin-top:3px}",
    ".covered{font-size:9px;color:#4b2cc9;font-weight:700;margin-top:3px}",
    ".reason{font-size:8.5px;color:#555;margin-top:3px}",
    ".empty{background:#fff;color:#bbb}",
    ".summary{margin-top:10px;font-size:10px;color:#555}",
    "</style></head><body>",
    "<div class='title'>FIKA Relief Team Rota</div>",
    "<div class='meta'><span>" + escapeHtmlForPdf_(cockpit.siteName || cockpit.siteId || "Site") + "</span><span>Week commencing " + escapeHtmlForPdf_(cockpit.weekStart || "") + "</span><span>" + String((assignments || []).length) + " assignment(s)</span></div>",
    "<table><thead><tr><th class='label'>Day</th>"
  ];
  weekRows.forEach(function(day) {
    html.push("<th>" + escapeHtmlForPdf_(day.weekday) + "</th>");
  });
  html.push("<th class='ot'>OT</th></tr><tr><th class='label'>Date</th>");
  weekRows.forEach(function(day) {
    html.push("<th>" + escapeHtmlForPdf_(formatPdfDate_(day.date)) + "</th>");
  });
  html.push("<th class='ot'>OT</th></tr></thead><tbody>");

  if (!personOrder.length) {
    html.push("<tr><td class='row-label'>Site</td><td colspan='" + String(weekRows.length + 1) + "' class='empty'>No relief cover generated for this selected week.</td></tr>");
  }

  personOrder.sort().forEach(function(person, index) {
    const colour = colours[index % colours.length];
    html.push("<tr class='person'><td colspan='" + String(weekRows.length + 2) + "' style='background:" + colour + "'>" + escapeHtmlForPdf_(person) + "</td></tr>");
    html.push("<tr><td class='row-label'>Site<br>Shift</td>");
    weekRows.forEach(function(day) {
      const rows = assignmentsByPerson[person][day.date] || [];
      if (!rows.length) {
        html.push("<td class='empty'>&nbsp;</td>");
        return;
      }
      html.push("<td>" + rows.map(function(row) {
        return "<div class='site'>" + escapeHtmlForPdf_(row["Site Name"] || row["Site ID"] || "") +
          (row.Role ? " - " + escapeHtmlForPdf_(row.Role) : "") + "</div>" +
          "<div class='shift'>Cover for " + escapeHtmlForPdf_(row["Covered Employee Name"] || "gap") + "</div>" +
          "<div class='covered'>" + escapeHtmlForPdf_(row.Status || "Draft") + " · Score " + escapeHtmlForPdf_(row.Score || "") + "</div>" +
          "<div class='reason'>" + escapeHtmlForPdf_(row.Reason || "") + "</div>";
      }).join("<hr>") + "</td>");
    });
    html.push("<td class='empty'>&nbsp;</td></tr>");
  });
  html.push("</tbody></table><div class='summary'>Generated from the selected Workforce Operations cockpit week. Draft relief assignments are subject to manager confirmation.</div></body></html>");
  return Utilities.newBlob(html.join(""), "text/html", filename.replace(/\.pdf$/i, ".html"))
    .getAs("application/pdf")
    .setName(filename);
}

function formatPdfDate_(dateText) {
  const date = new Date(String(dateText || "") + "T00:00:00");
  if (isNaN(date.getTime())) return String(dateText || "");
  return Utilities.formatDate(date, WORKFORCE_CONFIG.timeZone, "dd/MM/yyyy");
}

function escapeHtmlForPdf_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createAgencyRequestForGap(gapId, agencyId) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const gaps = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps));
  const agencies = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyContacts));
  const gap = gaps.filter(function(row) { return String(row["Gap ID"]) === String(gapId); })[0];
  if (!gap) throw new Error("Gap was not found.");
  const agency = agencyId
    ? agencies.filter(function(row) { return String(row["Agency ID"]) === String(agencyId); })[0]
    : agencies.filter(function(row) { return workforceBoolean_(row.Active); })[0];
  if (!agency) throw new Error("Add at least one active agency contact first.");
  const requestId = "agency_request_" + gap["Gap ID"];
  const row = {
    "Agency Request ID": requestId,
    "Site ID": gap["Site ID"],
    "Date": normaliseWorkforceDate_(gap.Date),
    "Role": gap.Role,
    "Agency": agency["Agency Name"],
    "Rate": agency["Default Rate"],
    "Hours": "",
    "Status": "Draft",
    "Requested By": Session.getActiveUser().getEmail(),
    "Notes": "Created from gap " + gap["Gap ID"] + " | Contact: " + (agency.Email || "")
  };
  upsertWorkforceRows_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyRequests), "Agency Request ID", [row]);
  return {
    ok: true,
    agencyRequestId: requestId,
    message: "Draft agency request created."
  };
}

function ensureReliefSuggestionsSheet_(spreadsheet) {
  return setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.reliefSuggestions, [
    "Suggestion ID", "Gap ID", "Site ID", "Date", "Role", "Suggested Employee ID",
    "Suggested Employee Name", "Reason", "Score", "Reviewed", "Approved"
  ]);
}

function ensureReliefAssignmentsSheet_(spreadsheet) {
  return setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.reliefAssignments, [
    "Assignment ID", "Gap ID", "Site ID", "Site Name", "Date", "Weekday",
    "Role", "Covering Employee ID", "Covering Employee Name", "Covering Email",
    "Covered Employee Name", "Status", "Score", "Reason", "Generated At", "Notes"
  ]);
}

function replaceWorkforceSheetRowsFast_(sheet, rowObjects) {
  if (!sheet) throw new Error("Target workforce sheet was not found.");
  clearWorkforceSheetData_(sheet);
  if (!rowObjects || !rowObjects.length) return;
  const map = workforceHeaderMap_(sheet);
  const headers = Object.keys(map);
  const values = rowObjects.map(function(rowObject) {
    return headers.map(function(header) {
      return Object.prototype.hasOwnProperty.call(rowObject, header)
        ? rowObject[header]
        : "";
    });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function buildCoverageGapIndex_(gaps) {
  const index = {};
  gaps.forEach(function(gap) {
    const date = normaliseWorkforceDate_(gap.Date);
    if (!date) return;
    const key = [
      String(gap["Site ID"] || ""),
      date,
      String(gap.Weekday || ""),
      normaliseWorkforcePerson_(gap["Employee Name"])
    ].join("|");
    index[key] = gap;
  });
  return index;
}

function scoreReliefCandidate_(person, gap, historySignal) {
  let score = 10;
  historySignal = historySignal || {};
  const role = String(gap.Role || "").toLowerCase();
  const personRole = String(person.Role || "").toLowerCase();
  if (personRole && role && (personRole.indexOf(role) !== -1 || role.indexOf(personRole) !== -1)) score += 50;
  if (workforceBoolean_(person["Relief Team"])) score += 25;
  if (String(person["Primary Site"] || "") === String(gap["Site Name"] || "")) score += 20;
  if (String(person["Secondary Sites"] || "").indexOf(String(gap["Site Name"] || "")) !== -1) score += 12;
  if (/chef/.test(role) && /chef/.test(personRole)) score += 25;
  if (/barista/.test(role) && /barista/.test(personRole)) score += 25;
  if (/hospitality/.test(role) && /hospitality/.test(personRole)) score += 20;
  score += Math.min(140, Number(historySignal.score || 0));
  return score;
}

function buildReliefReason_(person, gap, reliefMatch, historySignal) {
  const reasons = [];
  historySignal = historySignal || {};
  if (historySignal.exactCoverCount) {
    reasons.push("History: covered " + gap["Employee Name"] + " " + historySignal.exactCoverCount + " time(s)");
  } else if (historySignal.siteRoleCoverCount) {
    reasons.push("History: covered this site/role " + historySignal.siteRoleCoverCount + " time(s)");
  } else if (historySignal.roleCoverCount) {
    reasons.push("History: covered this role " + historySignal.roleCoverCount + " time(s)");
  }
  if (reliefMatch) reasons.push("Relief rota: " + reliefMatch["Site Name"] + " " + reliefMatch.Shift);
  if (person.Role) reasons.push("Role: " + person.Role);
  if (workforceBoolean_(person["Relief Team"])) reasons.push("Relief team");
  if (person["Primary Site"]) reasons.push("Primary site: " + person["Primary Site"]);
  return reasons.join(" | ") || "Available staff member";
}

function readCoverHistoryRows_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverHistory);
  return sheet ? readWorkforceObjects_(sheet) : [];
}

function buildCoverHistoryIndex_(rows) {
  const index = {};
  (rows || []).forEach(function(row) {
    if (String(row.Outcome || "").toLowerCase() === "cancelled") return;
    const covering = normaliseWorkforcePerson_(row["Covering Employee Name"]);
    const covered = normaliseWorkforcePerson_(row["Covered Employee Name"]);
    const siteId = String(row["Site ID"] || "");
    const role = String(row.Role || "").toLowerCase();
    if (!covering) return;
    incrementCoverHistoryIndex_(index, ["covering", covering].join("|"), row);
    if (covered) incrementCoverHistoryIndex_(index, ["covered", covered, "covering", covering].join("|"), row);
    if (covered && siteId) incrementCoverHistoryIndex_(index, ["covered", covered, "site", siteId, "covering", covering].join("|"), row);
    if (covered && role) incrementCoverHistoryIndex_(index, ["covered", covered, "role", role, "covering", covering].join("|"), row);
    if (siteId && role) incrementCoverHistoryIndex_(index, ["site", siteId, "role", role, "covering", covering].join("|"), row);
    if (role) incrementCoverHistoryIndex_(index, ["role", role, "covering", covering].join("|"), row);
  });
  return index;
}

function incrementCoverHistoryIndex_(index, key, row) {
  if (!index[key]) index[key] = { count: 0, lastDate: "" };
  index[key].count += 1;
  const date = normaliseWorkforceDate_(row.Date);
  if (date && (!index[key].lastDate || date > index[key].lastDate)) index[key].lastDate = date;
}

function getCoverHistorySignal_(index, gap, person) {
  index = index || {};
  const covering = normaliseWorkforcePerson_(person.Name || person["Employee Name"]);
  const covered = normaliseWorkforcePerson_(gap["Employee Name"]);
  const siteId = String(gap["Site ID"] || "");
  const role = String(gap.Role || "").toLowerCase();
  const exact = index[["covered", covered, "covering", covering].join("|")] || {};
  const exactSite = index[["covered", covered, "site", siteId, "covering", covering].join("|")] || {};
  const exactRole = index[["covered", covered, "role", role, "covering", covering].join("|")] || {};
  const siteRole = index[["site", siteId, "role", role, "covering", covering].join("|")] || {};
  const roleOnly = index[["role", role, "covering", covering].join("|")] || {};
  const exactCoverCount = Number(exact.count || 0);
  const siteRoleCoverCount = Number(siteRole.count || 0);
  const roleCoverCount = Number(roleOnly.count || 0);
  const score =
    Math.min(110, exactCoverCount * 45) +
    Math.min(35, Number(exactSite.count || 0) * 12) +
    Math.min(25, Number(exactRole.count || 0) * 8) +
    Math.min(30, siteRoleCoverCount * 10) +
    Math.min(15, roleCoverCount * 4);
  return {
    exactCoverCount: exactCoverCount,
    siteRoleCoverCount: siteRoleCoverCount,
    roleCoverCount: roleCoverCount,
    score: score,
    lastCoveredDate: exact.lastDate || exactSite.lastDate || exactRole.lastDate || siteRole.lastDate || roleOnly.lastDate || ""
  };
}

function buildReliefAvailabilityIndex_(rows) {
  const index = {};
  rows.forEach(function(row) {
    const date = normaliseWorkforceDate_(row.Date);
    if (!date) return;
    if (String(row.Status || "").toLowerCase() === "unavailable") return;
    if (String(row.Status || "").toLowerCase() === "bank holiday") return;
    if (!index[date]) index[date] = [];
    index[date].push(row);
  });
  return index;
}

function findReliefAvailabilityForPerson_(rows, personName) {
  const clean = normaliseWorkforcePerson_(personName);
  return (rows || []).filter(function(row) {
    return normaliseWorkforcePerson_(row["Relief Name"]) === clean;
  })[0] || null;
}

function buildRotaCoverIndex_(exceptions) {
  const index = {};
  exceptions.forEach(function(exception) {
    if (!isGapClearedByException_(exception)) return;
    const date = normaliseWorkforceDate_(exception.Date);
    if (!date) return;
    const role = String(exception.Role || "");
    if (!role) return;
    index[getCoverDateRoleKey_(exception["Site ID"], date, role)] = exception;
  });
  return index;
}

function getCoverDateRoleKey_(siteId, dateText, role) {
  return [
    String(siteId || ""),
    normaliseWorkforceDate_(dateText),
    normaliseRoleForCover_(role)
  ].join("|");
}

function normaliseRoleForCover_(role) {
  return String(role || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueWorkforceRotaTemplates_(templates) {
  const byKey = {};
  (templates || []).forEach(function(template) {
    const key = getRotaTemplateDuplicateKey_(template);
    if (!key) return;
    const existing = byKey[key];
    if (!existing ||
        String(existing.Source || "") !== "Web App" ||
        String(template.Source || "") === "Web App") {
      byKey[key] = template;
    }
  });
  return Object.keys(byKey).map(function(key) { return byKey[key]; });
}

function getRotaTemplateDuplicateKey_(template) {
  return [
    String(template["Site ID"] || "").trim().toLowerCase(),
    String(template.Weekday || "").trim().toLowerCase(),
    normaliseRoleForCover_(template.Role),
    normaliseWorkforcePerson_(template["Employee Name"]),
    String(template["Standard Status"] || "").trim().toUpperCase()
  ].join("|");
}

function normaliseWeekStart_(value) {
  const dateText = normaliseWorkforceDate_(value) || getNextMonday_();
  const date = new Date(dateText + "T00:00:00");
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime() + diff * 86400000);
  return Utilities.formatDate(monday, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
}

function getWeekDates_(weekStart) {
  const start = new Date(weekStart + "T00:00:00");
  const days = [];
  for (let index = 0; index < 7; index++) {
    const date = new Date(start.getTime() + index * 86400000);
    days.push({
      date: Utilities.formatDate(date, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd"),
      weekday: getWorkforceWeekday_(date)
    });
  }
  return days;
}

function getNextMonday_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const add = day === 1 ? 0 : (8 - day) % 7 || 7;
  return Utilities.formatDate(new Date(today.getTime() + add * 86400000), WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
}

function clearWorkforceSheetData_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
}
