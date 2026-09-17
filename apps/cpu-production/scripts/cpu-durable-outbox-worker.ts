import { recoverCpuPropagation } from "../lib/cpu-durable-outbox";

/**
 * Long-lived CPU delivery worker. It is the normal recovery path for durable
 * delivery and T+60 reconciliation obligations; the HTTP route remains
 * available for diagnostics and replay.
 */
const intervalMs = Math.min(Math.max(Number(process.env.CPU_OUTBOX_POLL_MS || 5_000), 1_000), 60_000);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });

console.info("FIKA CPU durable outbox worker started", { intervalMs });
while (!stopping) {
  try {
    const results = await recoverCpuPropagation();
    if (results.length) console.info("FIKA CPU durable outbox worker drained due deliveries", { count: results.length, delivered: results.filter(result => result.status === "delivered").length });
  } catch (error) {
    console.error("FIKA CPU durable outbox worker iteration failed", { errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error) });
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}

console.info("FIKA CPU durable outbox worker stopped");
