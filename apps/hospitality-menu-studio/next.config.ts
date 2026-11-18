import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
const buildSha = resolveFikaBuildSha();

export default function config(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    output: "standalone",
    env: { FIKA_BUILD_SHA: buildSha },
    generateBuildId: async () => buildSha,
    experimental: { externalDir: true },
    transpilePackages: ["@fika/server-shared"],
    outputFileTracingRoot: development ? repoRoot : appRoot,
    ...(development ? { turbopack: { root: repoRoot } } : {}),
  };
}
