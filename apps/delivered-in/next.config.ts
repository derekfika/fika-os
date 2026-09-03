import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  generateBuildId: async () => process.env.FIKA_BUILD_SHA?.trim() || null,
  experimental: { externalDir: true },
  transpilePackages: ["@fika/server-shared"],
  outputFileTracingRoot: appRoot,
};
export default nextConfig;
