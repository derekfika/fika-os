import * as XLSX from "xlsx";

export const ANGEL_COURT_INBOX_ADAPTER_VERSION = "fika.angel-court-inbox-adapter.v1";
export const ANGEL_COURT_GMAIL_QUERY = "in:anywhere -in:trash -in:spam filename:xlsx";

export type AngelCourtInboxMetadata = {
  messageId: string;
  attachmentName: string;
  threadId?: string;
  receivedAt?: string;
  from?: string;
  subject?: string;
  /** Optional source site used by the shared legacy CPU adapter. */
  location?: string;
};

export type AngelCourtBookingCandidate = {
  adapterVersion: string;
  sourceKey: string;
  source: AngelCourtInboxMetadata;
  location: string;
  clientName: string;
  hostName: string;
  email: string;
  phone: string;
  eventDate: string;
  serviceTime: string;
  deliveryTime: string;
  guestCount: number | null;
  roomOrArea: string;
  notes: string;
  items: Array<{ name: string; quantity: number | null; category?: string; details?: string; serviceTime?: string }>;
  warnings: string[];
};

export type AngelCourtInboxAttachment = AngelCourtInboxMetadata & { content: Buffer | Uint8Array };

/** Deterministic scan core for a future Gmail worker; deliberately provider-neutral. */
export function scanAngelCourtAttachments(attachments: readonly AngelCourtInboxAttachment[], processedKeys: ReadonlySet<string> = new Set()) {
  const seen = new Set<string>(processedKeys);
  const candidates: AngelCourtBookingCandidate[] = [];
  const skipped: string[] = [];
  for (const attachment of attachments) {
    const key = makeAngelCourtSourceKey(attachment.messageId, attachment.attachmentName);
    if (seen.has(key)) {
      skipped.push(key);
      continue;
    }
    seen.add(key);
    candidates.push(parseAngelCourtWorkbook(attachment.content, attachment));
  }
  return { candidates, skipped, processedKeys: seen };
}

export function buildAngelCourtInboxQuery(options: { earliestScanDate?: string; lastScanAt?: string } = {}) {
  const dates = [options.earliestScanDate, options.lastScanAt?.slice(0, 10)].filter(Boolean) as string[];
  if (dates.length === 0) return `${ANGEL_COURT_GMAIL_QUERY} newer_than:90d`;
  const earliest = dates.sort()[0].replaceAll("-", "/");
  return `${ANGEL_COURT_GMAIL_QUERY} after:${earliest}`;
}

export function makeAngelCourtSourceKey(messageId: string, attachmentName: string) {
  return `${messageId}|${attachmentName}`;
}

function text(value: unknown) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function findValue(rows: unknown[][], labels: string[]) {
  const wanted = labels.map((label) => label.toLowerCase());
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const cell = text(row[i]).toLowerCase();
      const found = wanted.find((label) => cell === label || cell.startsWith(label));
      if (found) return text(row[i]).slice(found.length).replace(/^[:\-]\s*/, "") || text(row[i + 1]);
    }
  }
  return "";
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function parseTime(value: unknown) {
  const raw = text(value).toLowerCase();
  const match = raw.match(/^(\d{1,2})(?::|\.)(\d{2})(?:\s*(am|pm))?$/) || raw.match(/^(\d{1,2})\s*(am|pm)$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2]?.length === 2 && /^\d+$/.test(match[2]) ? Number(match[2]) : 0;
  const meridian = match[3] || match[2];
  if (meridian === "pm" && hour !== 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseItems(rows: unknown[][]) {
  const items: AngelCourtBookingCandidate["items"] = [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => /item|menu|product/i.test(text(cell))) && row.some((cell) => /qty|quantity|number/i.test(text(cell))));
  if (headerIndex < 0) return items;
  const header = rows[headerIndex].map(text);
  const itemIndex = Math.max(0, header.findIndex((x) => /item|menu|product/i.test(x)));
  const quantityIndex = header.findIndex((x) => /qty|quantity|number/i.test(x));
  for (const row of rows.slice(headerIndex + 1)) {
    const name = text(row[itemIndex]);
    if (!name || /total|notes?|price|date|delivery/i.test(name)) continue;
    const quantityText = quantityIndex >= 0 ? text(row[quantityIndex]) : "";
    const quantityMatch = quantityText.match(/\d+(?:\.\d+)?/);
    items.push({ name, quantity: quantityMatch ? Number(quantityMatch[0]) : null, details: text(row[itemIndex + 1]) || undefined });
  }
  return items;
}

export function parseAngelCourtWorkbook(buffer: Buffer | Uint8Array, source: AngelCourtInboxMetadata): AngelCourtBookingCandidate {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Angel Court workbook has no worksheet.");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
  const candidate: AngelCourtBookingCandidate = {
    adapterVersion: ANGEL_COURT_INBOX_ADAPTER_VERSION,
    sourceKey: makeAngelCourtSourceKey(source.messageId, source.attachmentName),
    source,
    location: source.location || "One Angel Court",
    clientName: findValue(rows, ["Company Name:", "Company:"]),
    hostName: findValue(rows, ["Name:", "Host:"]),
    email: findValue(rows, ["Email:", "Email address:"]),
    phone: findValue(rows, ["Phone:", "Telephone:"]),
    eventDate: parseDate(findValue(rows, ["Date of event:", "Date of delivery (DD/MM/YY):", "Date:"])),
    serviceTime: parseTime(findValue(rows, ["Service time:", "Event time:"])),
    deliveryTime: parseTime(findValue(rows, ["Delivery time:", "Kitchen departure time:"])),
    guestCount: Number(findValue(rows, ["Total Number of people:", "Number of people:", "Guests:"])) || null,
    roomOrArea: findValue(rows, ["Floor Level", "Floor, room or delivery point", "Room:"]),
    notes: findValue(rows, ["Notes:", "Additional notes:"]),
    items: parseItems(rows),
    warnings: [],
  };
  if (!candidate.eventDate) candidate.warnings.push("Event date could not be parsed.");
  if (!candidate.serviceTime) candidate.warnings.push("Service time could not be parsed.");
  if (candidate.items.length === 0) candidate.warnings.push("No item/quantity rows were detected.");
  if (!candidate.clientName) candidate.warnings.push("Client/company was not detected.");
  if (!candidate.hostName) candidate.warnings.push("Requester/host was not detected.");
  if (!candidate.email) candidate.warnings.push("Requester email was not detected.");
  return candidate;
}
