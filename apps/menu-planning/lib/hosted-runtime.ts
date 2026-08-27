export function assertOperationalStoreAvailable() {
  if (["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "")) {
    throw Object.assign(new Error("Menu Planning operational data is not connected in this hosted environment yet. No local files or fixture data were used."), { status: 503, code: "MENU_OPERATIONAL_STORE_NOT_CONFIGURED" });
  }
}
