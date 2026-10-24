import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@fika/server-shared"], experimental: { externalDir: true }, turbopack: { root: path.resolve(__dirname, "../..") }, outputFileTracingRoot: path.resolve(__dirname, "../..") };
export default config;
