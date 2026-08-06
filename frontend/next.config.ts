import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/Order-Automation",
  assetPrefix: "/Order-Automation/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;