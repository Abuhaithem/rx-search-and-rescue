import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rxsr/core", "@rxsr/db", "@rxsr/report"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb", // formulary PDFs upload through server actions
    },
  },
};

export default nextConfig;
