import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);
const repoRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: { externalDir: true },
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default nextConfig;
