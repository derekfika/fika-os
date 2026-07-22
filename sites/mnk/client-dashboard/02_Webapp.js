function doGet() {
  return HtmlService.createTemplateFromFile("Index").evaluate()
    .setTitle(CLIENT_PORTAL_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
