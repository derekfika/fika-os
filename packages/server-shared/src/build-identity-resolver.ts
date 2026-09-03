import { execFileSync } from "node:child_process";

const FULL_SHA = /^[0-9a-f]{40}$/i;

function validSha(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && FULL_SHA.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function gitHead(cwd: string) {
  try {
    return validSha(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return undefined;
  }
}

/** Resolve the exact source commit for a build, failing closed on ambiguity. */
export function resolveFikaBuildSha(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const candidates = [env.FIKA_BUILD_SHA, env.COMMIT_SHA, env.REVISION_ID, env.GIT_COMMIT_SHA, env.GITHUB_SHA].map(validSha).filter((value): value is string => Boolean(value));
  const uniqueEnvironmentShas = [...new Set(candidates)];
  if (uniqueEnvironmentShas.length > 1) throw new Error("Build provenance environment variables disagree about the git commit SHA.");

  const repositorySha = gitHead(cwd);
  const environmentSha = uniqueEnvironmentShas[0];
  if (repositorySha && environmentSha && repositorySha !== environmentSha) throw new Error(`Build provenance mismatch: git HEAD is ${repositorySha}, but the build environment supplied ${environmentSha}.`);

  const resolved = repositorySha || environmentSha;
  if (!resolved) throw new Error("Unable to resolve a full git commit SHA for this build; refusing to use unknown build provenance.");
  return resolved;
}
