import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  turbopack: {
    root: path.resolve(__dirname, "../.."),
    resolveAlias: {
      "firebase-admin": "./apps/logistics/node_modules/firebase-admin",
      jszip: "./apps/logistics/node_modules/jszip",
      papaparse: "./apps/logistics/node_modules/papaparse",
      xlsx: "./apps/logistics/node_modules/xlsx",
      zod: "./apps/logistics/node_modules/zod",
    },
  },
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};
export default nextConfig;
