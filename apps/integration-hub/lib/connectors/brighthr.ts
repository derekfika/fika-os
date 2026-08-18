/* eslint-disable @typescript-eslint/no-explicit-any */
import { brightHrFixture } from "@/fixtures/brighthr";
import type { ReportSyncProgress } from "../sync-service";

type Employee = Record<string, any>;
type Absence = Record<string, any>;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function requestToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const url = process.env.BRIGHTHR_TOKEN_URL, id = process.env.BRIGHTHR_CLIENT_ID, secret = process.env.BRIGHTHR_CLIENT_SECRET;
  if (!url || !id || !secret || !url.startsWith("https://")) throw new Error("BrightHR live-local credentials are incomplete or unsafe.");
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }), cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error("BrightHR authentication failed."), { status: response.status });
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("BrightHR token response was incomplete.");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 300) * 1000 };
  return cachedToken.value;
}

async function brightRequest(path: string, body: Record<string, unknown>, retry = true) {
  const base = process.env.BRIGHTHR_API_BASE_URL;
  if (!base?.startsWith("https://")) throw new Error("BrightHR API base URL is missing or unsafe.");
  const response = await fetch(`${base.replace(/\/$/, "")}/${path}`, { method: "POST", headers: { authorization: `Bearer ${await requestToken()}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (response.status === 429 && retry) { await new Promise(resolve => setTimeout(resolve, 500)); return brightRequest(path, body, false); }
  if (response.status === 401 && retry) { cachedToken = null; return brightRequest(path, body, false); }
  if (!response.ok) throw Object.assign(new Error("BrightHR returned a safe connector error."), { status: response.status });
  return response.json() as Promise<Record<string, any>>;
}

export async function fetchBrightHr(report?: ReportSyncProgress) {
  const mode = process.env.BRIGHTHR_MODE === "live-local" ? "live-local" : "fixture";
  if (mode === "fixture") { await report?.({ phase: "Reading fixture", message: "Loading safe synthetic BrightHR Legends and absences.", percent: 45 }); return { mode, ...brightHrFixture }; }
  await report?.({ phase: "Retrieving Legends", message: "Connecting to BrightHR and requesting the first employee page.", percent: 5 });
  const employees: Employee[] = []; let continuationToken = "", employeePage = 0;
  do { const data = await brightRequest("employees/v1/query", continuationToken ? { continuationToken } : {}); employeePage += 1; employees.push(...(data.items || data.results || data.data || [])); await report?.({ phase: "Retrieving Legends", message: `BrightHR employee page ${employeePage} received; ${employees.length} Legends collected.`, completed: employees.length }); continuationToken = data.continuationToken || ""; } while (continuationToken);
  const absences: Absence[] = [];
  const startDate = new Date(Date.now() - Number(process.env.BRIGHTHR_ABSENCE_LOOKBACK_DAYS || 30) * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + Number(process.env.BRIGHTHR_ABSENCE_LOOKAHEAD_DAYS || 90) * 86400000).toISOString().slice(0, 10);
  let partial = false;
  for (const [index, employee] of employees.entries()) {
    try { let token = ""; do { const data = await brightRequest("absences/v1/query", { employeeId: employee.id || employee.employeeId, startDate, endDate, ...(token ? { continuationToken: token } : {}) }); absences.push(...(data.items || data.results || data.data || [])); token = data.continuationToken || ""; } while (token); } catch { partial = true; }
    if ((index + 1) % 5 === 0 || index + 1 === employees.length) await report?.({ phase: "Retrieving absences", message: `${index + 1} of ${employees.length} Legends checked; ${absences.length} absence records collected.`, completed: index + 1, total: employees.length || 1, percent: 15 + Math.round(((index + 1) / Math.max(employees.length, 1)) * 65) });
  }
  await report?.({ phase: "Transforming workforce data", message: `${employees.length} Legends and ${absences.length} absences collected. Applying termination and rota evidence.`, completed: employees.length + absences.length, total: employees.length + absences.length || 1, percent: 85 });
  return { mode, employees, absences, partial };
}

export function normaliseBrightEmployee(employee: Employee) {
  const name = employee.name || {}, employment = employee.employment || {}, metadata = employee._metadata || {};
  const startDate = employment.start || employment.startDate || employee.startDate || undefined;
  const terminationDate = employment.terminationDate || employment.end || employee.terminationDate || employee.endDate || undefined;
  const terminated = Boolean(metadata.isTerminated || terminationDate || /terminated|inactive|left|leaver/i.test(String(employment.status || employee.status || "")));
  return { externalId: String(employee.id || employee.employeeId), displayName: [name.givenName || name.firstName, name.familyName || name.lastName].filter(Boolean).join(" ") || employee.fullName || employee.displayName || "", workEmail: employee.email || undefined, jobTitle: employment.jobTitle || employee.jobTitle || undefined, employmentState: terminated ? "Terminated" : employment.status || employee.status || "Active", active: !terminated, terminated, startDate: startDate ? String(startDate).slice(0, 10) : undefined, terminationDate: terminationDate ? String(terminationDate).slice(0, 10) : undefined, providerVersion: String(metadata.version || employee.version || ""), workLocationReferences: extractBrightHrWorkLocations(employee) };
}

export function extractBrightHrWorkLocations(employee: Employee) {
  const employment = employee.employment || {};
  const candidates = [employee.workLocation, employee.workLocations, employee.location, employee.locations, employee.site, employee.sites, employment.workLocation, employment.workLocations, employment.location, employment.locations, employment.site, employment.sites].flatMap(value => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
  const references = candidates.map(value => {
    if (typeof value === "string" || typeof value === "number") return { providerLocationId: "", name: String(value).trim() };
    if (typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return { providerLocationId: String(record.id || record.locationId || record.siteId || "").trim(), name: String(record.name || record.displayName || record.locationName || record.siteName || "").trim() };
  }).filter((value): value is { providerLocationId: string; name: string } => Boolean(value && (value.providerLocationId || value.name)));
  return references.filter((value, index) => references.findIndex(candidate => candidate.providerLocationId === value.providerLocationId && candidate.name.toLowerCase() === value.name.toLowerCase()) === index);
}

export function normaliseBrightAbsence(absence: Absence) { return { externalId: String(absence.id || absence.absenceId), employeeExternalId: String(absence.employeeId || absence.employee?.id || ""), startDate: String(absence.startDate || absence.start || absence.dateFrom || "").slice(0, 10), endDate: String(absence.endDate || absence.end || absence.dateTo || absence.startDate || "").slice(0, 10), absenceType: absence.type || absence.absenceType || absence.displayName || undefined, approvalState: absence.status || absence.approvalStatus || "Approved" }; }

export function clearBrightHrTokenForTests() { cachedToken = null; }
