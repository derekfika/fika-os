import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);

const config: NextConfig = {
  output: "standalone",
  generateBuildId: async () => process.env.FIKA_BUILD_SHA?.trim() || null,
  experimental: { externalDir: true },
  outputFileTracingRoot: appRoot,
};
export default config;
