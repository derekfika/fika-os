import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" }, externalDir: true },
  outputFileTracingRoot: appRoot,
};

export default nextConfig;
