/** Execution guards. Pure functions so every refusal is unit-tested; the CLI calls them before any store is created. */
export const PROJECT_ALLOWLIST = { production: "fika-os", staging: "fika-os-dev" } as const;
export type EnvironmentClass = "memory" | "emulator" | "staging" | "production";
export const REAL_FIRESTORE_ENV = "FIKA_CUTOVER_ALLOW_REAL_FIRESTORE";

export class GuardError extends Error {
  constructor(readonly violations: string[]) { super(`Refused: ${violations.join("; ")}`); this.name = "GuardError"; }
}

export type GuardEnv = Record<string, string | undefined>;

/** Classifies a project id. Anything not on the allowlist is refused outright. */
export function classifyProject(project: string | undefined, env: GuardEnv = {}): EnvironmentClass {
  if (!project) throw new GuardError(["--project is required"]);
  if (project.startsWith("demo-")) {
    if (!env.FIRESTORE_EMULATOR_HOST) throw new GuardError([`demo project "${project}" needs FIRESTORE_EMULATOR_HOST (emulator only)`]);
    return "emulator";
  }
  if (env.FIRESTORE_EMULATOR_HOST) throw new GuardError([`FIRESTORE_EMULATOR_HOST is set but "${project}" is not a demo-* project; unset it or use a demo project`]);
  if (project === PROJECT_ALLOWLIST.staging) return "staging";
  if (project === PROJECT_ALLOWLIST.production) return "production";
  throw new GuardError([`project "${project}" is not on the allowlist (${Object.values(PROJECT_ALLOWLIST).join(", ")}, demo-* with the emulator)`]);
}

export type ConnectFlags = { allowProduction?: boolean; allowStaging?: boolean };
/** Reading or writing a real (non-emulator) Firestore needs an environment opt-in as well as the project flags. */
export function assertCanConnect(project: string | undefined, flags: ConnectFlags, env: GuardEnv = {}): EnvironmentClass {
  const environment = classifyProject(project, env);
  const violations: string[] = [];
  if (environment === "staging" || environment === "production") {
    if (env[REAL_FIRESTORE_ENV] !== "1") violations.push(`${REAL_FIRESTORE_ENV}=1 is not set (real Firestore access is disabled by default)`);
    if (environment === "production" && !flags.allowProduction) violations.push("production needs --allow-production");
    if (environment === "staging" && !flags.allowStaging) violations.push("staging needs --allow-staging");
  }
  if (violations.length) throw new GuardError(violations);
  return environment;
}

export type WriteFlags = ConnectFlags & {
  /** In-memory rehearsal store: no project, no network. */
  memory?: boolean;
  execute?: boolean;
  approvalHash?: string;
  /** The hash the tool itself just computed (plan hash for execute, restore intent hash for restore). */
  computedHash: string;
  approvedBy?: string;
};
/** Everything that must hold before ANY write. Returns the environment class on success. */
export function assertCanWrite(project: string | undefined, flags: WriteFlags, env: GuardEnv = {}): EnvironmentClass {
  const violations: string[] = [];
  let environment: EnvironmentClass | undefined;
  if (flags.memory) environment = "memory";
  else try { environment = assertCanConnect(project, flags, env); } catch (error) { violations.push(...(error as GuardError).violations); }
  if (!flags.execute) violations.push(`--execute is required for any write (default is a read-only dry run); computed hash ${flags.computedHash}`);
  const real = environment === "staging" || environment === "production";
  if (real) {
    if (!flags.approvedBy?.trim()) violations.push("--approved-by <person> is required and must be recorded");
    if (!flags.approvalHash) violations.push("--approval-hash is required and must equal the reviewed plan hash");
  }
  if (flags.approvalHash && flags.approvalHash !== flags.computedHash) violations.push(`--approval-hash ${flags.approvalHash.slice(0, 12)}… does not equal the computed hash ${flags.computedHash.slice(0, 12)}… (state or inputs changed since approval)`);
  if (violations.length) throw new GuardError(violations);
  return environment!;
}
