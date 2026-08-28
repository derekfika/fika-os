import type { NextConfig } from "next";

// Keep App Hosting's project root at this app. A monorepo-wide root causes
// NFT/type analysis to walk unrelated sibling applications.
const config: NextConfig = { experimental: { externalDir: true }, turbopack: { root: __dirname } };
export default config;
