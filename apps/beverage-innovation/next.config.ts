import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared FIKA tokens and the canonical server-shared package live at this worktree root.
  turbopack: { root: path.resolve(process.cwd(), "../..") },
};

export default nextConfig;
