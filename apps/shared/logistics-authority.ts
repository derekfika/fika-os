/** AUTHMOD stable resource IDs. Labels are presentation, never authority. */
export const LOGISTICS_VEHICLE_IDS = ["van1", "van2"] as const;
export type LogisticsVehicleId = (typeof LOGISTICS_VEHICLE_IDS)[number];
export const logisticsVehicleLabel = (id: LogisticsVehicleId) => id === "van1" ? "Van 1" : "Van 2";
export const isLogisticsVehicleId = (id: unknown): id is LogisticsVehicleId =>
  typeof id === "string" && (LOGISTICS_VEHICLE_IDS as readonly string[]).includes(id);
export const LOGISTICS_MAINTENANCE_AUTHORITIES = ["logistics.repair", "logistics.reconcile", "logistics.reset"] as const;
export type LogisticsMaintenanceAuthority = (typeof LOGISTICS_MAINTENANCE_AUTHORITIES)[number];
export type LogisticsDriverOption = { driverId: string; displayName: string; permittedDriverVehicleIds: LogisticsVehicleId[] };
