import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The GoRules ZEN engine is a native NAPI module (.node binary). It must be
  // externalized from the server bundle so Next.js does not try to bundle the
  // native addon (which would break it). Server-only Daily Direction code is the
  // only consumer; it never reaches the browser bundle.
  serverExternalPackages: ['@gorules/zen-engine'],
  experimental: {
    // Raise the body clone limit for routes that use middleware.
    // The policy-import route is excluded from the middleware matcher entirely,
    // so it never hits this limit — but raise it anyway for other large uploads.
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
