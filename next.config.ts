import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    deviceSizes: [512],
    imageSizes: [],
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 604800,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname:
          "/within-glide/cache-probes/codex-private-cache-20260804.jpg",
      },
    ],
  },
};

export default nextConfig;
