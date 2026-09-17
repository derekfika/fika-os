import path from "node:path";
import type { NextConfig } from "next";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

const appRoot = path.resolve(__dirname);
const buildSha = resolveFikaBuildSha();

const config: NextConfig = {
  output: "standalone",
  env: { FIKA_BUILD_SHA: buildSha },
  generateBuildId: async () => buildSha,
  experimental: { externalDir: true },
  transpilePackages: ["@fika/server-shared"],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      zod: path.resolve(appRoot, "node_modules/zod"),
    };
    return webpackConfig;
  },
  outputFileTracingRoot: appRoot,
};
export default config;
