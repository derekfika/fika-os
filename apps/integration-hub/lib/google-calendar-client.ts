import fs from "node:fs/promises";
import { existsSync } from "node:fs";

export type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  updated?: string;
  htmlLink?: string;
  creator?: { email?: string; displayName?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  attachments?: Array<{ fileUrl?: string; title?: string; mimeType?: string; fileName?: string; contentBase64?: string }>;
};

type OAuthClient = { client_id: string; client_secret?: string; token_uri?: string };
type ClientDocument = { installed?: OAuthClient; web?: OAuthClient };
type StoredToken = { access_token?: string; refresh_token?: string; expiry_date?: number; expires_in?: number; token_uri?: string };

const clientPath = () => process.env.CPU_CALENDAR_OAUTH_CLIENT_FILE ?? "C:\\FIKA\\secrets\\calendar-oauth-client.json";
const tokenPath = () => process.env.CPU_CALENDAR_OAUTH_TOKEN_FILE ?? "C:\\FIKA\\secrets\\cpu-calendar-token.json";

async function credentials() {
  if (!existsSync(clientPath())) throw new Error(`CPUX Calendar OAuth client not found at ${clientPath()}. Run npm run auth:cpu-calendar first.`);
  if (!existsSync(tokenPath())) throw new Error(`CPUX Calendar OAuth token not found at ${tokenPath()}. Run npm run auth:cpu-calendar first.`);
  const clientDoc = JSON.parse(await fs.readFile(clientPath(), "utf8")) as ClientDocument;
  const client = clientDoc.installed ?? clientDoc.web;
  const token = JSON.parse(await fs.readFile(tokenPath(), "utf8")) as StoredToken;
  if (!client?.client_id || !token.refresh_token) throw new Error(`CPUX Calendar OAuth token is incomplete at ${tokenPath()}. Run npm run auth:cpu-calendar again.`);
  return { client, token };
}

async function accessToken() {
  const { client, token } = await credentials();
  if (token.access_token && (!token.expiry_date || token.expiry_date > Date.now() + 60_000)) return token.access_token;
  const refreshToken = token.refresh_token;
  if (!refreshToken) throw new Error("CPUX Calendar OAuth refresh token is missing.");
  const response = await fetch(client.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret ?? "", refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Google Calendar token refresh failed: ${await response.text()}`);
  const refreshed = await response.json() as { access_token: string; expires_in?: number };
  await fs.writeFile(tokenPath(), `${JSON.stringify({ ...token, ...refreshed, expiry_date: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined }, null, 2)}\n`);
  return refreshed.access_token;
}

async function googleGet<T>(url: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!response.ok) throw new Error(`Google Calendar API ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

export async function listCpuCalendarEvents(calendarId: string, window: { timeMin: Date; timeMax: Date }) {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin: window.timeMin.toISOString(), timeMax: window.timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", showDeleted: "true", maxResults: "2500", fields: "nextPageToken,items(id,status,summary,description,location,start,end,updated,htmlLink,creator,organizer,attendees,attachments)" });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleGet<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    events.push(...(result.items ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events.map((event) => ({ ...event, calendarId }));
}

function driveFileId(url?: string) {
  if (!url) return undefined;
  return url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]{10,})/)?.[1];
}

export async function hydrateCalendarAttachments(events: GoogleCalendarEvent[]) {
  return Promise.all(events.map(async (event) => ({ ...event, attachments: await Promise.all((event.attachments ?? []).map(async (attachment) => {
    const id = driveFileId(attachment.fileUrl);
    if (!id) return attachment;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok) return attachment;
    return { ...attachment, fileName: attachment.title, contentBase64: Buffer.from(await response.arrayBuffer()).toString("base64") };
  })) })));
}
