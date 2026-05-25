import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Raise the body clone limit for routes that use middleware.
    // The policy-import route is excluded from the middleware matcher entirely,
    // so it never hits this limit — but raise it anyway for other large uploads.
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
