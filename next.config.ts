import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and per-tenant, so Cache Components (on in the
  // scaffold) stays off until we deliberately design cached, non-personal data.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    // Document uploads go through server actions; keep in step with
    // MAX_UPLOAD_BYTES (10 MB) plus multipart overhead.
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
