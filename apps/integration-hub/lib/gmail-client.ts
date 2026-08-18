import fs from "node:fs/promises";

export type GmailOAuthClient = {
  client_id: string;
  client_secret: string;
  auth_uri?: string;
  token_uri: string;
  redirect_uris?: string[];
};

export type GmailOAuthToken = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  expires_in?: number;
  scope?: string;
};

export type GmailAttachment = {
  messageId: string;
  threadId?: string;
  attachmentName: string;
  mimeType?: string;
  receivedAt?: string;
  from?: string;
  subject?: string;
  content: Buffer;
};

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }>; parts?: GmailPart[]; body?: GmailPart["body"] };
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function decodeBase64Url(value: string) {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

export function collectGmailParts(part: GmailPart | undefined, output: GmailPart[] = []) {
  if (!part) return output;
  if (part.filename && /\.xlsx?$/i.test(part.filename)) output.push(part);
  for (const child of part.parts || []) collectGmailParts(child, output);
  return output;
}

export function gmailQueryUrl(query: string, pageToken?: string) {
  const params = new URLSearchParams({ q: query, maxResults: "100" });
  if (pageToken) params.set("pageToken", pageToken);
  return `${GMAIL_API}/messages?${params.toString()}`;
}

async function gmailRequest<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gmail API ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body) as T;
}

export async function readGmailOAuthFiles(clientPath: string, tokenPath: string) {
  const clientDocument = JSON.parse(await fs.readFile(clientPath, "utf8")) as { installed?: GmailOAuthClient; web?: GmailOAuthClient };
  const client = clientDocument.installed || clientDocument.web;
  if (!client?.client_id || !client.client_secret || !client.token_uri) throw new Error("Gmail OAuth client JSON is missing required fields.");
  const token = JSON.parse(await fs.readFile(tokenPath, "utf8")) as GmailOAuthToken;
  if (!token.refresh_token) throw new Error("Gmail token JSON has no refresh_token. Run npm run auth:gmail first.");
  return { client, token };
}

export async function refreshGmailAccessToken(client: GmailOAuthClient, token: GmailOAuthToken) {
  const response = await fetch(client.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token!, grant_type: "refresh_token" }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google token refresh ${response.status}: ${body.slice(0, 500)}`);
  const refreshed = JSON.parse(body) as GmailOAuthToken;
  if (!refreshed.access_token) throw new Error("Google token refresh returned no access token.");
  return refreshed.access_token;
}

export async function fetchGmailXlsxAttachments(accessToken: string, query: string, maxMessages = 100): Promise<GmailAttachment[]> {
  const attachments: GmailAttachment[] = [];
  let pageToken: string | undefined;
  let fetchedMessages = 0;
  do {
    const page = await gmailRequest<{ messages?: Array<{ id: string; threadId?: string }>; nextPageToken?: string }>(gmailQueryUrl(query, pageToken), accessToken);
    for (const summary of page.messages || []) {
      if (fetchedMessages >= maxMessages) return attachments;
      fetchedMessages += 1;
      const message = await gmailRequest<GmailMessage>(`${GMAIL_API}/messages/${encodeURIComponent(summary.id)}?format=full`, accessToken);
      const parts: GmailPart[] = [];
      for (const rootPart of message.payload?.parts || []) collectGmailParts(rootPart, parts);
      for (const part of parts) {
        let content: Buffer | undefined;
        if (part.body?.data) content = decodeBase64Url(part.body.data);
        else if (part.body?.attachmentId) {
          const attached = await gmailRequest<{ data?: string }>(`${GMAIL_API}/messages/${encodeURIComponent(summary.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, accessToken);
          if (attached.data) content = decodeBase64Url(attached.data);
        }
        if (!content) continue;
        attachments.push({
          messageId: summary.id,
          threadId: summary.threadId || message.threadId,
          attachmentName: part.filename!,
          mimeType: part.mimeType,
          receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined,
          from: header(message, "From"),
          subject: header(message, "Subject"),
          content,
        });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken && fetchedMessages < maxMessages);
  return attachments;
}
