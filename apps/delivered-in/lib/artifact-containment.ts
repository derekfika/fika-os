// Response-only containment. Stored evidence and its status must remain unchanged.
export function containArtifactLinks<T>(value: T, blocked: boolean): T {
  if (!blocked) return value;
  const sensitive = new Set(["driveUrl", "driveFileId", "drivePdfUrl", "pdfDriveUrl", "pdfPath", "localUrl", "signedPdfUrl", "presentationUrl"]);
  function clean(input: unknown, artifact = false): unknown {
    if (Array.isArray(input)) return input.map(item => clean(item, artifact));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).flatMap(([key, item]) => {
      const context = artifact || /artifact|packet|bundle/i.test(key);
      if (sensitive.has(key) || (context && (key === "url" || key === "fileId"))) return [];
      if (typeof item === "string" && /https?:\/\/(drive|docs)\.google\.com\//i.test(item)) return [];
      return [[key, clean(item, context)]];
    }));
  }
  return clean(value) as T;
}
