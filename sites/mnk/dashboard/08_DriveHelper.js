function convertXlsxToGoogleSheet_(xlsxBlob) {
  const tempXlsx = DriveApp.createFile(xlsxBlob);

  try {
    tempXlsx.setName(`TEMP_BOOKING_${Date.now()}.xlsx`);

    const resource = {
      title: tempXlsx.getName().replace(/\.xlsx$/i, ""),
      mimeType: MimeType.GOOGLE_SHEETS
    };

    const converted = Drive.Files.copy(
      resource,
      tempXlsx.getId(),
      { convert: true }
    );

    return converted.id;

  } finally {
    try {
      tempXlsx.setTrashed(true);
    } catch (e) {}
  }
}