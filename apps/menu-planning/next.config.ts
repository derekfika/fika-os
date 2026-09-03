import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// App Hosting's adapter consumes the app-root standalone Webpack artifact.
const config: NextConfig = {
  output: "standalone",
  generateBuildId: async () => process.env.FIKA_BUILD_SHA?.trim() || null,
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
