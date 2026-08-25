/** Canonical origin used when CPU prepares work for delivery. */
export const CPU_PRODUCTION_LOCATION_ID = process.env.CPU_PRODUCTION_LOCATION_ID?.trim() || "oploc:cpu";

// FIKA Xchange is the CPU production site. Work whose destination is this
// OPLOC is produced on site and must not become a logistics delivery queue
// item. Movements originating here remain separate logistics work.
export const CPU_SITE_OPLOC_ID = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";
