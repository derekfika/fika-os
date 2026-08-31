import { AsyncLocalStorage } from "node:async_hooks";
import { endDataTrace as finish, isDataSourceTraceEnabled, recordDataAccess as record, startDataTrace as start, type DataAccessInput, type DataTraceInput } from "./data-source-meter";
import type { DataTrace } from "./data-source-meter";

const context = new AsyncLocalStorage<DataTrace>();
function emit(marker: string, value: unknown) { try { console.info(`${marker} ${JSON.stringify(value)}`); } catch { /* tracing must never affect application behaviour */ } }

export async function withDataTrace<T>(input: DataTraceInput, callback: () => Promise<T> | T): Promise<T> {
  const trace = start(input);
  if (!trace) return callback();
  emit("[FIKA_DATA_TRACE]", { phase: "START", app: trace.app, action: trace.action, path: trace.path, traceId: trace.traceId, ...(trace.requestId ? { requestId: trace.requestId } : {}) });
  return context.run(trace, async () => { try { return await callback(); } finally { const summary = finish(trace); for (const operation of summary?.records || []) emit("[FIKA_DATA_TRACE]", operation); if (summary) emit("[FIKA_DATA_TRACE_TOTAL]", summary); } });
}

export function recordDataAccess(input: DataAccessInput) { const trace = context.getStore(); if (trace) record(trace, input); }
export function setDataTraceOutcome(outcome: NonNullable<DataTraceInput["outcome"]>) { const trace = context.getStore(); if (trace) trace.outcome = outcome; }
export function currentDataTrace() { return context.getStore(); }
export function dataSourceTraceEnabled() { return isDataSourceTraceEnabled(); }
