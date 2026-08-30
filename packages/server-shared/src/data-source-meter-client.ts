import { endDataTrace as finish, recordDataAccess as record, startDataTrace as start, type DataAccessInput, type DataTraceInput } from "./data-source-meter";
import type { DataTrace } from "./data-source-meter";

let current: DataTrace | undefined;
function emit(marker: string, value: unknown) { try { console.info(`${marker} ${JSON.stringify(value)}`); } catch { /* tracing must never affect application behaviour */ } }

export async function withDataTrace<T>(input: DataTraceInput, callback: () => Promise<T> | T): Promise<T> {
  const trace = start(input);
  if (!trace) return callback();
  const previous = current;
  current = trace;
  emit("[FIKA_DATA_TRACE]", { phase: "START", app: trace.app, action: trace.action, path: trace.path, traceId: trace.traceId });
  try { return await callback(); } finally { const summary = finish(trace); for (const operation of summary?.records || []) emit("[FIKA_DATA_TRACE]", operation); if (summary) emit("[FIKA_DATA_TRACE_TOTAL]", summary); current = previous; }
}

export function recordDataAccess(input: DataAccessInput) { if (current) record(current, input); }
export function currentDataTrace() { return current; }
