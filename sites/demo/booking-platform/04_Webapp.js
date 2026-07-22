function doGet() {
  const template = HtmlService.createTemplateFromFile("Index");
  const publicConfig = getPublicPlatformConfig();
  template.platformConfig = JSON.stringify(publicConfig);
  return template.evaluate()
    .setTitle(publicConfig.site.clientFacingName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
