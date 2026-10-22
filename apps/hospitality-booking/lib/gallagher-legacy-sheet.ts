import { JWT } from "google-auth-library";
import { isApprovedGallagherRequester, visibilityPolicyConfigured, visibilityPolicyFromEnvironment } from "@/lib/gallagher-dashboard";

const SHEET_NAME = "Dashboard Data";
const MAX_ROWS = 5000;
const CACHE_MS = 60_000;
const REQUIRED_HEADERS = [
  "BookingID", "Status", "ClientCompany", "HostName", "HostEmail", "Pax", "EventDate",
  "ServiceTimes", "Location", "Floor", "Notes", "GrossPrice", "ItemsJSON", "ParsedJSON",
  "CreatedAt", "UpdatedAt", "InvoiceReference",
];

type LegacyRow = Record<string, unknown>;
let cached: { expiresAt: number; rows: LegacyRow[] } | undefined;
let pendingRead: Promise<LegacyRow[]> | undefined;

function environment(name: string) {
  return process.env[name]?.trim() || "";
}

function assertConfiguration() {
  if (!visibilityPolicyConfigured(visibilityPolicyFromEnvironment())) throw new Error("Gallagher dashboard visibility policy is not configured; no bookings are shown.");
  if (!environment("GALLAGHER_LEGACY_SHEET_ID")) throw new Error("Gallagher legacy booking source is not configured.");
  if (!environment("GALLAGHER_SHEETS_IMPERSONATED_USER")) throw new Error("Gallagher Sheets reader is not configured.");
  if (!environment("GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON")) throw new Error("Google Workspace delegated access is not configured.");
}

async function accessToken() {
  const credentials = JSON.parse(environment("GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON")) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Workspace delegated credentials are invalid.");
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    subject: environment("GALLAGHER_SHEETS_IMPERSONATED_USER"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const result = await auth.getAccessToken();
  if (!result.token) throw new Error("Google Sheets access could not be authorized.");
  return result.token;
}

function columns(headers: string[], values: unknown[]) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

async function readLegacyRows(): Promise<LegacyRow[]> {
  assertConfiguration();
  const policy = visibilityPolicyFromEnvironment();
  const token = await accessToken();
  const id = encodeURIComponent(environment("GALLAGHER_LEGACY_SHEET_ID"));
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet`);
  url.searchParams.append("ranges", `'${SHEET_NAME}'!A1:B${MAX_ROWS + 2}`);
  url.searchParams.append("ranges", `'${SHEET_NAME}'!J1:AM${MAX_ROWS + 2}`);
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("majorDimension", "ROWS");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
  const body = await response.json() as { valueRanges?: Array<{ values?: unknown[][] }> };
  const [leftRange, rightRange] = body.valueRanges || [];
  const left = leftRange?.values || [];
  const right = rightRange?.values || [];
  const leftHeaders = (left[0] || []).map((value) => String(value || "").trim());
  const rightHeaders = (right[0] || []).map((value) => String(value || "").trim());
  const headers = [...leftHeaders, ...rightHeaders];
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`The legacy Dashboard Data schema is missing required column(s): ${missing.join(", ")}.`);
  const rowCount = Math.max(left.length, right.length);
  if (rowCount > MAX_ROWS + 1) throw new Error("The legacy Dashboard Data sheet exceeds the safe read limit.");

  const rows: LegacyRow[] = [];
  for (let index = 1; index < rowCount; index += 1) {
    const values = [...(left[index] || []), ...(right[index] || [])];
    if (!values.some((value) => value !== "" && value !== null && value !== undefined)) continue;
    const row = columns(headers, values);
    if (isApprovedGallagherRequester(row.HostEmail, policy)) rows.push(row);
  }
  return rows;
}

/** Short successful-result cache, coalesced during a cold concurrent refresh. */
export async function getGallagherLegacyRows() {
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  if (!pendingRead) {
    pendingRead = readLegacyRows().then((rows) => {
      cached = { rows, expiresAt: Date.now() + CACHE_MS };
      return rows;
    }).finally(() => { pendingRead = undefined; });
  }
  return pendingRead;
}

export function clearGallagherLegacyCacheForTests() {
  cached = undefined;
  pendingRead = undefined;
}
