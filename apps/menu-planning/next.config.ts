import path from "node:path";
import type { NextConfig } from "next";

// Keep the build boundary at apps/ so shared contracts remain available while
// unrelated application trees are not traced into App Hosting builds.
const buildBoundary = path.resolve(__dirname, "..");
const config: NextConfig = { turbopack: { root: buildBoundary }, outputFileTracingRoot: buildBoundary };
export default config;
