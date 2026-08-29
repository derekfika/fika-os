import path from "node:path";
import type { NextConfig } from "next";

const appRoot = path.resolve(__dirname);

const config: NextConfig = {
  output: "standalone",
  experimental: { externalDir: true },
  outputFileTracingRoot: appRoot,
};
export default config;
