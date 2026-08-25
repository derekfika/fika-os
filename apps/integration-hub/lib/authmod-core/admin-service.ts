import type { AuthPrincipal } from "./model";
import { hasAuthmodAdmin } from "./authority";
import { commitAccessImport, previewAccessImport, type ImportDecision } from "./import-service";
import type { AuthModRepository } from "./repository";

export async function requireAuthmodAdmin(repository: AuthModRepository, principal: AuthPrincipal) {
  if (principal.type !== "interactive" || !(await hasAuthmodAdmin(repository, principal.id))) throw Object.assign(new Error("AUTHMOD Admin authority is required."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  return principal;
}

export async function previewAccessImportAsAdmin(repository: AuthModRepository, input: { buffer: Buffer; filename: string; actor: AuthPrincipal }) {
  await requireAuthmodAdmin(repository, input.actor);
  return previewAccessImport(repository, input);
}

export async function commitAccessImportAsAdmin(repository: AuthModRepository, input: { importId: string; actor: AuthPrincipal; decisions: Record<string, ImportDecision>; idempotencyKey: string }) {
  await requireAuthmodAdmin(repository, input.actor);
  return commitAccessImport(repository, input);
}
