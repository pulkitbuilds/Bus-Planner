import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include data/*.json in serverless function bundles on Vercel
  outputFileTracingIncludes: {
    "/api/**": ["./data/*.json"],
  },
};

export default nextConfig;
