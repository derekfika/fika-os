export function assertOperationalStoreAvailable() {
  // This guard is used only by the SQLite adapter. Hosted selection happens
  // in operational-store.ts and never constructs or falls back to SQLite.
  if (["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "")) {
    throw Object.assign(new Error("SQLite is not available in hosted Menu Planning runtime."), { status: 503, code: "MENU_OPERATIONAL_STORE_NOT_CONFIGURED" });
  }
}
