import type { NextConfig } from "next";

// Keep App Hosting's project root at this app. A monorepo-wide root causes
// NFT/type analysis to walk unrelated sibling applications.
const config: NextConfig = {
  turbopack: { root: __dirname },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/quotes/drive": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};
export default config;
