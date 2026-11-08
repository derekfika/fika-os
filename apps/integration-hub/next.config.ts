import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const stagingAuthDomain = process.env.FIKA_RUNTIME_MODE === "staging";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" }, externalDir: true },
  transpilePackages: ["@fika/server-shared"],
  async rewrites() {
    if (!stagingAuthDomain) return [];
    return {
      beforeFiles: [{ source: "/__/auth/:path*", destination: "https://fika-os-dev.firebaseapp.com/__/auth/:path*" }],
    };
  },
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
