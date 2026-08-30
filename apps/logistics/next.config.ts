import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: { externalDir: true },
};

export default nextConfig;
