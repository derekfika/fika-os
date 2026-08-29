export type IncrementalPage<T> = {
  hasMore: boolean;
  nextCursor: number;
  projection?: T;
};

export async function drainIncrementalPages<T>(
  initialCursor: number,
  fetchPage: (cursor: number) => Promise<IncrementalPage<T>>,
  maxPages = 1000,
) {
  let cursor = initialCursor;
  let latestProjection: T | undefined;
  let pages = 0;
  const seenCursors = new Set<number>();
  while (pages < maxPages) {
    const page = await fetchPage(cursor);
    const nextCursor = Number(page.nextCursor);
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    if (page.projection !== undefined) latestProjection = page.projection;
    cursor = nextCursor;
    pages += 1;
    if (!page.hasMore) break;
  }
  return { cursor, latestProjection, pages };
}
