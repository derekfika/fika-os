import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = { reactStrictMode: true, experimental: { externalDir: true }, turbopack: { root: path.resolve(__dirname, "../..") }, outputFileTracingRoot: path.resolve(__dirname, "../..") };
export default nextConfig;
