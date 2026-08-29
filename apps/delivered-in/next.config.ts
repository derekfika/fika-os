import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  turbopack: { root: path.resolve(__dirname, "../..") },
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  webpack: (config) => {
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...(config.resolve.modules ?? []),
    ];
    return config;
  },
};
export default nextConfig;
