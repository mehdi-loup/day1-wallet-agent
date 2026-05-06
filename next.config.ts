import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents Next.js from bundling Mastra packages — they use native modules (e.g. DuckDB)
  // that must stay as external dependencies in the Vercel Lambda bundle.
  serverExternalPackages: ['@mastra/*'],
  // Produces .next/standalone/ — a self-contained server + traced node_modules subset.
  // Required for the Docker runner stage; without it there's nothing minimal to COPY.
  output: 'standalone',
};

export default nextConfig;
