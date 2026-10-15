/** Hub-owned read projection consumed by Hospitality. Missing/unknown data never means No CPU. */
export type HospitalityLineRoutingState = "in_house" | "cpu_sandwiches" | "cpu_hospitality" | "cpu_delivered_in" | "routing_required" | "routing_conflict";
export type HospitalityBookingRoutingStatus = "cpu_required" | "no_cpu_production" | "routing_required" | "routing_conflict";
export type HospitalityRoutingProjection = {
  status: HospitalityBookingRoutingStatus;
  statusLabel: string;
  platform?: string;
  enforced?: boolean;
  lines: Array<{ index: number; state: HospitalityLineRoutingState; label: string; source?: string }>;
};
