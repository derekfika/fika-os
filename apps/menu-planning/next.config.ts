import type { NextConfig } from "next";
import path from "node:path";

// App Hosting requires Next's standalone artifact. Keep the existing
// monorepo Turbopack root so shared package imports resolve correctly.
const config: NextConfig = { output: "standalone", experimental: { externalDir: true }, transpilePackages: ["@fika/server-shared"], turbopack: { root: path.resolve(__dirname, "../..") } };
export default config;
