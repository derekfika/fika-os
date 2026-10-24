import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);

// Firebase App Hosting's Next.js adapter consumes the app-root standalone webpack artifact
// (`.next/standalone/.next/routes-manifest.json`), exactly like the other FIKA apps. Tracing from the
// repository root nests that output and the adapter cannot find it.
const config: NextConfig = {
  output: "standalone",
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
