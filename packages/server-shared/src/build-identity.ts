export type FikaBuildIdentity = { buildSha: string; runtimeRevision: string; source: "FIKA_BUILD_SHA" | "GIT_COMMIT_SHA" | "GITHUB_SHA" | "unknown" };

export function fikaBuildIdentity(env: NodeJS.ProcessEnv = process.env): FikaBuildIdentity {
  const candidates: Array<[FikaBuildIdentity["source"], string | undefined]> = [["FIKA_BUILD_SHA", env.FIKA_BUILD_SHA], ["GIT_COMMIT_SHA", env.GIT_COMMIT_SHA], ["GITHUB_SHA", env.GITHUB_SHA]];
  const found = candidates.find(([, value]) => Boolean(value?.trim()));
  return { buildSha: found?.[1]?.trim() || "unknown", runtimeRevision: env.K_REVISION?.trim() || env.BUILD_ID?.trim() || "unknown", source: found?.[0] || "unknown" };
}
