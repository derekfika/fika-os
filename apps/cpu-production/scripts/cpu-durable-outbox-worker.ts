import { recoverCpuPropagation } from "../lib/cpu-durable-outbox";
import { createAllergenAuthorityStore } from "../lib/allergen-authority-store";
import { ensureCascadeWorkForPendingAuthorities } from "../lib/allergen-reuse-orchestrator";

/**
 * Long-lived CPU delivery worker. It is the normal recovery path for durable
 * delivery and T+60 reconciliation obligations; the HTTP route remains
 * available for diagnostics and replay.
 */
const intervalMs = Math.min(Math.max(Number(process.env.CPU_OUTBOX_POLL_MS || 5_000), 1_000), 60_000);
/**
 * Shared allergen authority reconciliation: re-creates durable cascade work for any revoked authority with an incomplete cascade
 * (for example after a crash between an origin transition and its follow-up). Recurring cost: one bounded indexed query per
 * sweep (a single read when nothing is pending), every CPU_ALLERGEN_AUTHORITY_SWEEP_MS (default 60s, minimum 15s).
 */
const authoritySweepMs = Math.min(Math.max(Number(process.env.CPU_ALLERGEN_AUTHORITY_SWEEP_MS || 60_000), 15_000), 600_000);
let lastAuthoritySweep = 0;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });

console.info("FIKA CPU durable outbox worker started", { intervalMs });
while (!stopping) {
  try {
    if (Date.now() - lastAuthoritySweep >= authoritySweepMs) {
      lastAuthoritySweep = Date.now();
      const ensured = await ensureCascadeWorkForPendingAuthorities(createAllergenAuthorityStore()).catch(error => { console.error("FIKA CPU allergen authority reconciliation failed", { errorMessage: error instanceof Error ? error.message : String(error) }); return 0; });
      if (ensured) console.info("FIKA CPU allergen authority reconciliation ensured cascade work", { ensured });
    }
    const results = await recoverCpuPropagation();
    if (results.length) console.info("FIKA CPU durable outbox worker drained due deliveries", { count: results.length, delivered: results.filter(result => result.status === "delivered").length });
  } catch (error) {
    console.error("FIKA CPU durable outbox worker iteration failed", { errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error) });
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}

console.info("FIKA CPU durable outbox worker stopped");
