import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const appRoot = path.resolve(__dirname);
const repoRoot = path.resolve(appRoot, "../..");

const nextConfig = (phase: string): NextConfig => {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;
  const traceRoot = isDevServer ? repoRoot : appRoot;

  return {
    reactStrictMode: true,
    output: "standalone",
    experimental: { externalDir: true },
    transpilePackages: ["@fika/server-shared"],
    // App Hosting consumes the app-root standalone Webpack artifact. During
    // Turbopack development only, use the monorepo root so linked shared FIKA
    // source remains inside Turbopack's filesystem boundary.
    outputFileTracingRoot: traceRoot,
    ...(isDevServer ? { turbopack: { root: repoRoot } } : {}),
  };
};

export default nextConfig;
