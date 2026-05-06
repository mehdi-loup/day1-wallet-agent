import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents Next.js from bundling Mastra packages — they use native modules (e.g. DuckDB)
  // that must stay as external dependencies in the Vercel Lambda bundle.
  serverExternalPackages: ['@mastra/*'],
  // output: 'standalone' is required for the Docker runner stage (COPY .next/standalone/).
  // On Vercel, standalone mode breaks route registration — routes are missing from Vercel's
  // Lambda manifest and fall through to a cached 404. Skip it when VERCEL=1 is set.
  ...(!process.env.VERCEL ? { output: 'standalone' } : {}),
};

export default nextConfig;
