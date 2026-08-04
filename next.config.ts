import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Canvas media uses a deliberately small, finite transform ladder. The
    // 128px tier is stored in GCS, and originals are served directly.
    deviceSizes: [512, 1024, 2048],
    imageSizes: [],
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 604800,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/within-glide/**",
      },
    ],
  },
};

export default nextConfig;
