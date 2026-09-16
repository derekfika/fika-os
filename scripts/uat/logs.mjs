import { execFile, MAX_LOG_LIMIT, DEFAULT_LOG_MINUTES, DEFAULT_PROJECT, loggingLiteral, selectedApps, STAGING_APPS, redact } from "./common.mjs";

const FAILURE_CODES = new Set(["DELIVERED_IN_PROJECTION_LINEAGE_CONFLICT", "CPU_REVIEW_LINEAGE_MISMATCH", "CPU_REVIEW_UNAVAILABLE", "CPU_REVIEW_UNSIGNED", "CPU_DAILY_PACKET_INVALID", "MENU_SOURCE_UNAVAILABLE", "FIKA_SESSION_MISSING", "FIKA_SESSION_INVALID"]);
const HIGHLIGHT_TERMS = /projection|reconcile|recovery|invalidation|materiali[sz]e|handoff|outbox|sign(?:ature)?|review|publish|withdraw|amend|packet|lineage|release/i;
const SEVERITIES = new Set(["DEFAULT", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "ALERT", "EMERGENCY"]);

/**
 * Escape one logical argument for the command string consumed by CMD /c.
 * Metacharacters are placed outside a quoted segment and caret-escaped;
 * embedded quotes are doubled inside a quoted segment for the target argv
 * parser. Percent and delayed-expansion characters are escaped explicitly.
 */
export function escapeWindowsCmdArgument(value) {
  const input = String(value);
  if (/[\u0000\r\n]/.test(input)) throw new Error("gcloud arguments cannot contain NUL or newline characters.");
  if (!input) return '""';
  const metacharacters = new Set(["&", "|", "<", ">", "^", "%", "!"]);
  let command = "";
  let inQuotes = false;
  const openQuotes = () => { if (!inQuotes) { command += '"'; inQuotes = true; } };
  const closeQuotes = () => { if (inQuotes) { command += '"'; inQuotes = false; } };
  for (const character of input) {
    if (metacharacters.has(character)) {
      closeQuotes();
      command += `^${character}`;
    } else if (character === "(") {
      closeQuotes();
      command += "^(";
    } else if (character === ")") {
      closeQuotes();
      command += "^)";
    } else if (character === '"') {
      openQuotes();
      command += '""';
    } else {
      openQuotes();
      command += character;
    }
  }
  closeQuotes();
  return command;
}

export function buildGcloudInvocation(args, platform = process.platform, env = process.env) {
  if (platform !== "win32") return { executable: "gcloud", args };
  // Keep the fixed command token unquoted so cmd.exe /s /c does not apply its
  // special leading-quote rule. All variable arguments remain escaped below.
  const command = ["gcloud.cmd", ...args.map(escapeWindowsCmdArgument)].join(" ");
  return { executable: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", command] };
}

export function buildLoggingFilter({ app = "all", minutes = DEFAULT_LOG_MINUTES, since, serviceDate, oploc, buildSha, requestId, event, severity, now = new Date() } = {}) {
  const ids = selectedApps(app).map((id) => `resource.labels.service_name=${loggingLiteral(STAGING_APPS[id].service)}`);
  const clauses = [`resource.type="cloud_run_revision"`, `(${ids.join(" OR ")})`];
  if (since) clauses.push(`timestamp >= "${since}"`);
  else clauses.push(`timestamp >= "${new Date(now.valueOf() - minutes * 60_000).toISOString()}"`);
  if (serviceDate) clauses.push(`jsonPayload.serviceDate=${loggingLiteral(serviceDate)}`);
  if (oploc) clauses.push(`jsonPayload.oplocId=${loggingLiteral(oploc)}`);
  if (buildSha) clauses.push(`jsonPayload.buildSha=${loggingLiteral(buildSha)}`);
  if (requestId) clauses.push(`jsonPayload.requestId=${loggingLiteral(requestId)}`);
  if (event) clauses.push(`jsonPayload.event=${loggingLiteral(event)}`);
  if (severity) {
    const normalizedSeverity = String(severity).toUpperCase();
    if (!SEVERITIES.has(normalizedSeverity)) throw new Error(`--severity must be one of: ${[...SEVERITIES].join(", ")}.`);
    clauses.push(`severity >= ${normalizedSeverity}`);
  }
  return clauses.join(" AND ");
}

export async function verifyGcloud({ project = DEFAULT_PROJECT, run = runGcloud } = {}) {
  try {
    const accounts = JSON.parse((await run(["auth", "list", "--filter=status:ACTIVE", "--format=json"])).stdout || "[]");
    if (!Array.isArray(accounts) || !accounts.length) return { available: false, reason: "No active gcloud account is authenticated." };
    await run(["projects", "describe", project, "--format=json"]);
    return { available: true };
  } catch (error) {
    return { available: false, reason: redact(error?.stderr || error?.message || "gcloud is unavailable or project access failed.") };
  }
}

export async function runGcloud(args, { exec = execFile, cwd = process.cwd(), platform = process.platform, env = process.env } = {}) {
  const invocation = buildGcloudInvocation(args, platform, env);
  try { return await exec(invocation.executable, invocation.args, { cwd, windowsHide: true, windowsVerbatimArguments: platform === "win32", maxBuffer: 20 * 1024 * 1024 }); }
  catch (error) { throw Object.assign(new Error(redact(error?.message || "gcloud command failed")), { stderr: redact(error?.stderr || "") }); }
}

export async function readCloudLogs(options = {}, { run = runGcloud } = {}) {
  const project = options.project || DEFAULT_PROJECT;
  const limit = Math.min(options.limit || 500, MAX_LOG_LIMIT);
  const filterOptions = { ...options, severity: options.severity || "WARNING" };
  const auth = await verifyGcloud({ project, run });
  if (!auth.available) return { available: false, project, filter: buildLoggingFilter(filterOptions), records: [], warning: `${auth.reason} Install the Google Cloud CLI or run this command from Google Cloud Shell.` };
  const filter = buildLoggingFilter(filterOptions);
  try {
    const result = await run(["logging", "read", filter, `--project=${project}`, `--limit=${limit}`, "--format=json"]);
    let parsed;
    try { parsed = JSON.parse(result.stdout || "[]"); } catch { parsed = []; }
    const records = (Array.isArray(parsed) ? parsed : []).map(normalizeLogRecord).sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    return { available: true, project, filter, records, count: records.length };
  } catch (error) {
    return { available: false, project, filter, records: [], warning: redact(error?.stderr || error?.message || "Cloud Logging query failed.") };
  }
}

export function normalizeLogRecord(input) {
  if (!input || typeof input !== "object") return { malformed: true, timestamp: null, severity: "UNKNOWN", message: "Malformed Cloud Logging record", highlighted: true, raw: redact(input) };
  const json = typeof input.jsonPayload === "string" ? (() => { try { return JSON.parse(input.jsonPayload); } catch { return {}; } })() : (input.jsonPayload && typeof input.jsonPayload === "object" ? input.jsonPayload : {});
  const httpStatus = input.httpRequest?.status ?? json.httpStatus ?? json.status ?? json.errorStatus;
  const message = json.errorMessage || json.message || input.textPayload || input.message || input.protoPayload?.status?.message || "";
  const event = json.event || json.operation || "";
  const code = json.code || json.errorCode || "";
  const severity = String(input.severity || "DEFAULT").toUpperCase();
  const highlighted = ["ERROR", "CRITICAL", "ALERT", "EMERGENCY", "WARNING"].includes(severity) || FAILURE_CODES.has(String(code)) || HIGHLIGHT_TERMS.test(`${event} ${message}`) || [409, 422].includes(Number(httpStatus)) || Number(httpStatus) >= 500;
  return {
    timestamp: input.timestamp || null,
    severity,
    service: input.resource?.labels?.service_name || json.service || null,
    revision: input.resource?.labels?.revision_name || json.revision || null,
    app: json.app || null,
    event: event || null,
    operation: json.operation || null,
    serviceDate: json.serviceDate || null,
    oplocId: json.oplocId || null,
    buildSha: json.buildSha || null,
    requestId: json.requestId || null,
    eventId: json.eventId || null,
    status: httpStatus === undefined ? null : Number(httpStatus) || httpStatus,
    code: code || null,
    error: message || null,
    highlighted,
    raw: redact(input),
  };
}

export function formatLogRecord(record) {
  const time = record.timestamp ? new Date(record.timestamp).toISOString().slice(11, 23) : "unknown-time";
  const head = `${time}  ${String(record.severity).padEnd(5)}  ${record.app || "unknown-app"}  ${record.service || "unknown-service"}`;
  const detail = [record.buildSha && `build: ${record.buildSha}`, record.event && `event: ${record.event}`, record.operation && `operation: ${record.operation}`, record.serviceDate && `date: ${record.serviceDate}`, record.oplocId && `oploc: ${record.oplocId}`, record.status && `status: ${record.status}`, record.code && `code: ${record.code}`, record.error && `error: ${redact(record.error)}`, record.requestId && `request: ${record.requestId}`, record.eventId && `eventId: ${record.eventId}`].filter(Boolean);
  return [head, ...detail.map(item => `  ${item}`)].join("\n");
}

export function formatLogs(result) {
  const lines = [`CLOUD LOGS (${result.project})`, `Filter: ${result.filter}`, ""];
  if (!result.available) return lines.concat([`UNAVAILABLE: ${result.warning || "Cloud Logging could not be queried."}`, "", "No records collected."]).join("\n");
  if (!result.records.length) return lines.concat(["No records found."]).join("\n");
  return lines.concat(result.records.map(formatLogRecord)).join("\n\n");
}

export { FAILURE_CODES };
