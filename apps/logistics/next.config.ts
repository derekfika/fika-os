import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  turbopack: {
    root: path.resolve(__dirname, "../.."),
    resolveAlias: {
      "firebase-admin": "./node_modules/firebase-admin",
      "firebase-admin/app": "./node_modules/firebase-admin/app",
      "firebase-admin/auth": "./node_modules/firebase-admin/auth",
      "firebase-admin/firestore": "./node_modules/firebase-admin/firestore",
      jszip: "./node_modules/jszip",
      papaparse: "./node_modules/papaparse",
      xlsx: "./node_modules/xlsx",
      zod: "./node_modules/zod",
    },
  },
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};
export default nextConfig;
