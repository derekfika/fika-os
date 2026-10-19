/**
 * Runs asynchronous commands strictly one at a time, in the order they were requested. A failure never blocks later commands.
 * The review editor uses it so back-to-back plan saves each carry the revision the previous response returned, instead of all
 * carrying the same stale token and conflicting with each other.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
}
