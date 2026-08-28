const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");

export function menuPlanningHubBaseUrl() {
  const configured = process.env.FIKA_HUB_BASE_URL || process.env.INTEGRATION_HUB_BASE_URL;
  if (hosted() && !configured) throw Object.assign(new Error("Menu Planning Hub endpoint is not configured for hosted runtime."), { status: 503, code: "MENU_HUB_ENDPOINT_NOT_CONFIGURED" });
  return (configured || "http://localhost:3200").replace(/\/$/, "");
}
