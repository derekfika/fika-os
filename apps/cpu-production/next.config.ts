import type { NextConfig } from "next";

// Keep App Hosting's build boundary at CPU Production. A monorepo-wide root
// causes Turbopack/NFT analysis to walk Integration Hub and sibling apps.
const config: NextConfig = { turbopack: { root: __dirname } };
export default config;
