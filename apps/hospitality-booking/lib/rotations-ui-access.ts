/** A preview-only route guard; production management access belongs to the server AUTHMOD adapter. */
export function isRotationsPreviewAvailable(environment: string | undefined) {
  return environment !== "production";
}
