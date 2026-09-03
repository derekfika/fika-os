import path from "node:path";
import type { NextConfig } from "next";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

const appRoot = path.resolve(__dirname);
const buildSha = resolveFikaBuildSha();
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  env: { FIKA_BUILD_SHA: buildSha },
  generateBuildId: async () => buildSha,
  experimental: { externalDir: true },
  transpilePackages: ["@fika/server-shared"],
  outputFileTracingRoot: appRoot,
};
export default nextConfig;
