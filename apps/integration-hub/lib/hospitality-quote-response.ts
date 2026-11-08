const DRIVE_QUOTE_FIELDS = new Set(["driveUrl", "driveFileId", "fileId", "webViewLink"]);

/** Remove stored quote artifact pointers from API responses when Drive is unavailable in this runtime. */
export function redactHospitalityQuoteDriveLinks<T>(value: T, driveUnavailable: boolean): T {
  if (!driveUnavailable) return value;
  const visit = (current: unknown, inQuote: boolean): unknown => {
    if (Array.isArray(current)) return current.map(item => visit(item, inQuote));
    if (!current || typeof current !== "object") return current;
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return current;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) {
      if (inQuote && DRIVE_QUOTE_FIELDS.has(key)) continue;
      result[key] = visit(child, inQuote || key === "quote" || key === "quoteState");
    }
    return result;
  };

  return visit(value, false) as T;
}
