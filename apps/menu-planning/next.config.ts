import type { NextConfig } from "next";
import path from "node:path";

// Keep App Hosting's project root at this app. A monorepo-wide root causes
// NFT/type analysis to walk unrelated sibling applications.
const config: NextConfig = { experimental: { externalDir: true }, transpilePackages: ["@fika/server-shared"], turbopack: { root: path.resolve(__dirname, "../..") } };
export default config;
