import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: { externalDir: true },
  outputFileTracingRoot: appRoot,
};
export default nextConfig;
