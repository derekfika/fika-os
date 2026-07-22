function runWorkforcePlatformTests() {
  const status = getBrightHrApiStatus();
  const reliefDryRun = safeTestReliefRotaGeneratorDryRun_();
  return {
    ok: true,
    tests: [
      {
        name: "BrightHR status can be read without exposing secrets",
        ok: status.ok === true &&
          Object.prototype.hasOwnProperty.call(status, "hasClientSecret")
      },
      {
        name: "Workforce config has core rota sheets",
        ok: Boolean(WORKFORCE_CONFIG.sheets.staffDirectory) &&
          Boolean(WORKFORCE_CONFIG.sheets.rotaShifts)
      },
      {
        name: "Relief rota generator has usable inputs",
        ok: reliefDryRun.ok,
        details: reliefDryRun
      }
    ],
    reliefRotaGenerator: reliefDryRun
  };
}

function authoriseRotaSnapshotDriveAccess() {
  const folder = getOrCreateRotaSnapshotFolder_();
  return {
    ok: true,
    folderId: folder.getId(),
    folderName: folder.getName(),
    message: "Drive access authorised for rota snapshots."
  };
}

function safeTestReliefRotaGeneratorDryRun_() {
  try {
    return testReliefRotaGeneratorDryRun();
  } catch (error) {
    return {
      ok: false,
      mode: "dry_run",
      error: error.message || String(error)
    };
  }
}

function testReliefRotaGeneratorDryRun(daysAhead) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const missingSheets = [
    WORKFORCE_CONFIG.sheets.coverageGaps,
    WORKFORCE_CONFIG.sheets.absences,
    WORKFORCE_CONFIG.sheets.reliefAvailability,
    WORKFORCE_CONFIG.sheets.staffDirectory,
    WORKFORCE_CONFIG.sheets.reliefSuggestions,
    WORKFORCE_CONFIG.sheets.reliefAssignments,
    WORKFORCE_CONFIG.sheets.coverHistory
  ].filter(function(sheetName) {
    return !spreadsheet.getSheetByName(sheetName);
  });
  if (missingSheets.length) {
    return {
      ok: false,
      mode: "dry_run",
      error: "Missing required sheet(s): " + missingSheets.join(", ")
    };
  }

  const gaps = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps))
    .filter(function(gap) {
      return String(gap.Status || "").toLowerCase() !== "resolved";
    });
  const absences = buildAbsenceIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.absences)
  ));
  const reliefAvailability = buildReliefAvailabilityIndex_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.reliefAvailability)
  ));
  const coverHistory = buildCoverHistoryIndex_(readCoverHistoryRows_(spreadsheet));
  const staff = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.staffDirectory))
    .filter(function(person) {
      return isReliefCandidate_(person, reliefAvailability);
    });
  const preview = [];
  gaps.slice(0, Math.max(1, Number(daysAhead || 28))).forEach(function(gap) {
    const date = normaliseWorkforceDate_(gap.Date);
    const availableRelief = reliefAvailability[date] || [];
    const best = staff
      .filter(function(person) {
        return String(person.Name || "") &&
          normaliseWorkforcePerson_(person.Name) !== normaliseWorkforcePerson_(gap["Employee Name"]) &&
          !absences[getGapPersonDateKey_(person.Name, date)];
      })
      .map(function(person) {
        const reliefMatch = findReliefAvailabilityForPerson_(availableRelief, person.Name);
        const historySignal = getCoverHistorySignal_(coverHistory, gap, person);
        return {
          name: person.Name,
          score: scoreReliefCandidate_(person, gap, historySignal) + (reliefMatch ? 60 : 0),
          reason: buildReliefReason_(person, gap, reliefMatch, historySignal)
        };
      })
      .sort(function(a, b) { return b.score - a.score; })[0] || null;
    preview.push({
      gapId: gap["Gap ID"],
      site: gap["Site Name"] || gap["Site ID"],
      date: date,
      role: gap.Role,
      coveredEmployee: gap["Employee Name"],
      bestSuggestion: best
    });
  });

  return {
    ok: true,
    mode: "dry_run",
    note: "No Suggestions or Assignments sheets were changed.",
    unresolvedGaps: gaps.length,
    reliefCandidates: staff.length,
    reliefAvailabilityDays: Object.keys(reliefAvailability || {}).length,
    coverHistoryRows: readCoverHistoryRows_(spreadsheet).length,
    preview: preview.slice(0, 10),
    warnings: [
      !gaps.length ? "No unresolved gaps found. Run gap detection or load a cockpit week with absences first." : "",
      !staff.length ? "No relief candidates found. Check Relief Team flags or relief availability import." : ""
    ].filter(Boolean)
  };
}
