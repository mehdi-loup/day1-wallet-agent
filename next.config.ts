import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents Next.js from bundling Mastra packages — they use native modules (e.g. DuckDB)
  // that must stay as external dependencies in the Vercel Lambda bundle.
  serverExternalPackages: ['@mastra/*'],
};

export default nextConfig;
