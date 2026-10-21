import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native module: load it from node_modules at runtime instead of bundling it
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
