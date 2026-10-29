import { command } from './runtime.mjs';

/** Read-only Cloud Logging API. Keep filter syntax out of cmd.exe, never relax its guard. */
export async function readCreateAuditEvents(t, sinceMs, { token = () => command('gcloud', ['auth', 'print-access-token', '--quiet']), fetchImpl = fetch } = {}) {
  try {
    if (!Number.isFinite(sinceMs) || !/^[a-z0-9-]+$/.test(t.project) || !/^[a-z0-9-]+$/.test(t.backend)) throw Error('Invalid audit target');
    const bearer = await token();
    const filter = `protoPayload.serviceName="firebaseapphosting.googleapis.com" AND protoPayload.methodName=~"(CreateRollout|CreateBuild)" AND timestamp>="${new Date(sinceMs).toISOString()}"`;
    const events = []; const seen = new Set(); let pageToken;
    for (let page = 0; page < 100; page++) {
      const response = await fetchImpl('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNames: [`projects/${t.project}`], filter, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error('Audit read failed');
      const data = await response.json();
      if (!data || (data.entries !== undefined && !Array.isArray(data.entries))) throw Error('Invalid audit response');
      for (const row of data.entries || []) {
        const resource = String(row.protoPayload?.resourceName || '');
        const marker = `/backends/${t.backend}`;
        if (resource.endsWith(marker) || resource.includes(`${marker}/`)) events.push({ at: row.timestamp, method: row.protoPayload?.methodName });
      }
      if (!data.nextPageToken) return { readable: true, events };
      if (typeof data.nextPageToken !== 'string' || seen.has(data.nextPageToken)) throw Error('Invalid audit pagination');
      seen.add(data.nextPageToken); pageToken = data.nextPageToken;
    }
    throw Error('Audit pagination limit reached');
  } catch { return { readable: false, events: [] }; }
}
