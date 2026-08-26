import type { AuthPrincipal, ApplicationRegistryEntry } from "./model";
import { appendAudit } from "./audit";
import { V1_APPLICATIONS, now } from "./model";
import type { AuthModRepository } from "./repository";

export async function seedApplicationRegistry(repository: AuthModRepository, actor: AuthPrincipal) {
  const created: ApplicationRegistryEntry[] = [];
  for (const application of V1_APPLICATIONS) {
    if (await repository.getApplication(application.appId)) continue;
    const value = { ...application, createdAt: now(), updatedAt: now() };
    await repository.saveApplication(value);
    await appendAudit(repository, { actor, targetType: "ApplicationRegistry", targetId: value.appId, action: "application-registered", afterState: value, provenance: "migration", outcome: "committed" });
    created.push(value);
  }
  return created;
}

export async function ensureV1ApplicationRegistry(repository: AuthModRepository, actor: AuthPrincipal) {
  return seedApplicationRegistry(repository, actor);
}
