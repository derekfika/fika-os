function doGet(event) {
  const token = String(event && event.parameter && event.parameter.token || "");
  const publicConfig = getPublicFeedbackConfig_(token);
  const template = HtmlService.createTemplateFromFile("Index");
  template.feedbackToken = JSON.stringify(token);
  template.publicConfig = JSON.stringify(publicConfig);
  return template.evaluate()
    .setTitle(publicConfig.clientFacingName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
