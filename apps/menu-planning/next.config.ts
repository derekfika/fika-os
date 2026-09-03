import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const buildSha = resolveFikaBuildSha();

// App Hosting's adapter consumes the app-root standalone Webpack artifact.
const config: NextConfig = {
  output: "standalone",
  env: { FIKA_BUILD_SHA: buildSha },
  generateBuildId: async () => buildSha,
  experimental: { externalDir: true },
  transpilePackages: ["@fika/server-shared"],
  outputFileTracingRoot: appRoot,
  webpack: (webpackConfig, { isServer }) => {
    if (!isServer) {
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        crypto: false,
        path: false,
        "node:crypto": false,
        "node:path": false,
      };
    }
    return webpackConfig;
  },
};
export default config;
