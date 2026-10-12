/**
 * Latest-wins save coalescing for the CPU allergen review matrix.
 *
 * Every save carries the COMPLETE matrix state, so a save that starts while another is in flight can safely replace any
 * save that has been queued but not yet started. Saves still run one at a time (never concurrently, so a slow earlier write
 * cannot land after a later one), but N rapid edits cost one in-flight save plus at most ONE trailing save, instead of N
 * sequential round trips.
 */
export function createSaveCoalescer<P>(run: (payload: P) => Promise<void>) {
  let inFlight: Promise<void> | undefined;
  let queued: { payload: P; promise: Promise<void> } | undefined;

  const settle = (operation: Promise<void>) => {
    const clear = () => { if (inFlight === operation) inFlight = undefined; };
    operation.then(clear, clear);
  };

  return {
    /** Resolves when the save that contains THIS payload (or a newer one that replaced it) has completed. */
    submit(payload: P): Promise<void> {
      if (!inFlight) {
        const operation = run(payload);
        inFlight = operation;
        settle(operation);
        return operation;
      }
      if (queued) {
        queued.payload = payload; // not started yet: the newest full state replaces it
        return queued.promise;
      }
      const entry = { payload, promise: undefined as unknown as Promise<void> };
      entry.promise = inFlight.catch(() => undefined).then(() => {
        queued = undefined; // from here on a new edit queues a fresh trailing save behind this one
        return run(entry.payload);
      });
      queued = entry;
      inFlight = entry.promise;
      settle(entry.promise);
      return entry.promise;
    },
    /** The newest outstanding save (running or queued), if any. */
    get pending() { return inFlight; },
  };
}
