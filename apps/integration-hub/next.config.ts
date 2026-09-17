import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" }, externalDir: true },
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

export default nextConfig;
