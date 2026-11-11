/** Stable write-relevant fields shared by diagnostic and write-capable catch-up plans. */
export const hospitalityCatchUpWriteIntent = (preview: Record<string, unknown>) => Object.fromEntries(
  Object.entries(preview).filter(([key]) => !["quoteRevision", "quoteAccess", "identityStatus", "currentEvent", "conflictingEvents", "attendeeCopies"].includes(key)),
);
