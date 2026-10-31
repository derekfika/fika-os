/** Complete, scoped App Hosting discovery. Repeated tokens stay an integrity failure. */
export async function discover(resource, key, select, read) {
  const rows = []; const seen = new Set(); let token;
  do {
    const page = await read(`${resource}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    rows.push(...(page[key] || []).map(select)); token = page.nextPageToken;
    if (token && seen.has(token)) throw Error('Repeated recovery discovery page token');
    if (token) seen.add(token);
  } while (token);
  return rows.sort((a,b) => a.name.localeCompare(b.name));
}
