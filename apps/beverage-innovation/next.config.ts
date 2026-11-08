import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
const buildSha = resolveFikaBuildSha();

const config = (phase: string): NextConfig => {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    output: "standalone",
    env: { FIKA_BUILD_SHA: buildSha },
    generateBuildId: async () => buildSha,
    experimental: { externalDir: true },
    transpilePackages: ["@fika/server-shared"],
    // App Hosting consumes the app-root standalone Webpack artifact. During
    // Turbopack development only, trace the repository root so linked shared
    // FIKA packages remain inside the dev server's filesystem boundary.
    outputFileTracingRoot: isDevServer ? repoRoot : appRoot,
    ...(isDevServer ? { turbopack: { root: repoRoot } } : {}),
  };
};

export default config;
