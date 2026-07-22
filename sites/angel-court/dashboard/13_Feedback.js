function getHospitalityFeedbackMetrics() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const requestSheet = spreadsheet.getSheetByName("Feedback Requests");
  const responseSheet = spreadsheet.getSheetByName("Feedback Responses");
  const itemSheet = spreadsheet.getSheetByName("Feedback Item Ratings");

  const requestRows = getFeedbackMetricRows_(requestSheet);
  const responseRows = getFeedbackMetricRows_(responseSheet);
  const itemRows = getFeedbackMetricRows_(itemSheet);
  const sent = requestRows.filter(function(row) {
    return feedbackMetricBoolean_(row["Request Sent"]);
  }).length;
  const completed = requestRows.filter(function(row) {
    return feedbackMetricBoolean_(row.Completed);
  }).length;

  const overall = responseRows
    .map(function(row) { return Number(row["Overall Satisfaction"]); })
    .filter(function(value) { return value >= 1 && value <= 5; });
  const npsValues = responseRows
    .map(function(row) { return Number(row.NPS); })
    .filter(function(value) { return value >= 0 && value <= 10; });
  const promoters = npsValues.filter(function(value) { return value >= 9; }).length;
  const detractors = npsValues.filter(function(value) { return value <= 6; }).length;

  const itemGroups = {};
  itemRows.forEach(function(row) {
    const name = String(row["Item Name"] || "Menu item");
    const rating = Number(row.Rating);
    if (!(rating >= 1 && rating <= 5)) return;
    if (!itemGroups[name]) itemGroups[name] = { itemName: name, total: 0, responses: 0 };
    itemGroups[name].total += rating;
    itemGroups[name].responses++;
  });

  const items = Object.keys(itemGroups).map(function(name) {
    const item = itemGroups[name];
    return {
      itemName: item.itemName,
      average: Math.round((item.total / item.responses) * 10) / 10,
      responses: item.responses
    };
  }).sort(function(a, b) {
    return b.responses - a.responses || b.average - a.average;
  }).slice(0, 8);

  return {
    available: Boolean(requestSheet || responseSheet || itemSheet),
    sent: sent,
    completed: completed,
    responseRate: sent ? Math.round((completed / sent) * 100) : 0,
    averageOverall: overall.length
      ? Math.round((overall.reduce(function(sum, value) { return sum + value; }, 0) / overall.length) * 10) / 10
      : null,
    nps: npsValues.length
      ? Math.round(((promoters - detractors) / npsValues.length) * 100)
      : null,
    lowRatings: responseRows.filter(function(row) {
      return Number(row["Overall Satisfaction"]) <= 2;
    }).length,
    items: items
  };
}

function getFeedbackMetricRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(function(header) { return String(header); });
  return values.map(function(valuesRow) {
    const row = {};
    headers.forEach(function(header, index) {
      row[header] = valuesRow[index];
    });
    return row;
  });
}

function feedbackMetricBoolean_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}
