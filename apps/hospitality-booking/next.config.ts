import path from "node:path";
import type { NextConfig } from "next";

/**
 * Shared FIKA assets live at the workspace root. Keeping the Turbopack root
 * there allows apps to consume those assets without duplicating them into
 * app-local public folders.
 */
const config: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "../..") },
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};
export default config;
