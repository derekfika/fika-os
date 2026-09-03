import { readFileSync } from "node:fs";
import path from "node:path";

export type FikaBuildIdentity = { buildSha: string; runtimeRevision: string; source: "FIKA_BUILD_SHA" | "GIT_COMMIT_SHA" | "GITHUB_SHA" | "NEXT_STANDALONE_CONFIG" | "NEXT_BUILD_ID" };

const FULL_SHA = /^[0-9a-f]{40}$/i;

function standaloneConfigSha(env: NodeJS.ProcessEnv) {
  try {
    const config = JSON.parse(env.__NEXT_PRIVATE_STANDALONE_CONFIG || "") as { env?: { FIKA_BUILD_SHA?: unknown } };
    return typeof config.env?.FIKA_BUILD_SHA === "string" ? config.env.FIKA_BUILD_SHA.trim() : undefined;
  } catch {
    return undefined;
  }
}

function nextBuildId(cwd: string) {
  try {
    return readFileSync(path.join(cwd, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return undefined;
  }
}

export function fikaBuildIdentity(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): FikaBuildIdentity {
  const candidates: Array<[FikaBuildIdentity["source"], string | undefined]> = [["FIKA_BUILD_SHA", env.FIKA_BUILD_SHA], ["GIT_COMMIT_SHA", env.GIT_COMMIT_SHA], ["GITHUB_SHA", env.GITHUB_SHA], ["NEXT_STANDALONE_CONFIG", standaloneConfigSha(env)], ["NEXT_BUILD_ID", nextBuildId(cwd)]];
  const found = candidates.find(([, value]) => Boolean(value?.trim()));
  if (!found || !FULL_SHA.test(found[1]!.trim())) throw new Error("Build provenance is unavailable or is not a full git commit SHA.");
  return { buildSha: found[1]!.trim().toLowerCase(), runtimeRevision: env.K_REVISION?.trim() || env.BUILD_ID?.trim() || "unknown", source: found[0] };
}
