/** Raised when an AUTHMOD write committed but the follow-up access-package publication failed. */
export class AuthmodCommittedPublicationError extends Error {
  readonly committed = true as const;
  readonly code = "AUTHMOD_PACKAGE_PUBLICATION_FAILED";
  readonly status = 500;
  constructor(readonly identityId: string, cause: unknown) {
    super("The change was saved, but the access package could not be republished. Do not repeat the change; ask an administrator to republish this account's package.");
    this.cause = cause;
  }
}
export const isCommittedPublicationError = (error: unknown): error is AuthmodCommittedPublicationError => error instanceof AuthmodCommittedPublicationError;

/** Publish after a committed write. Inactive identities have no package by design; other failures are surfaced as committed. */
export async function publishAfterCommit(identityId: string, publish: (identityId: string) => Promise<unknown>) {
  try { await publish(identityId); }
  catch (error) {
    if ((error as { code?: string }).code === "AUTHMOD_IDENTITY_INACTIVE") return;
    throw new AuthmodCommittedPublicationError(identityId, error);
  }
}

/** Run a command; a committed-write publication failure becomes a warning instead of a failed save. */
export async function runCommittedCommand(command: () => Promise<unknown>): Promise<{ warning?: string }> {
  try { await command(); return {}; }
  catch (error) { if (isCommittedPublicationError(error)) { console.error("AUTHMOD write committed; package publication failed", { code: error.code, identityId: error.identityId }); return { warning: error.message }; } throw error; }
}
