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
  // Keep the browser on `/storybook/` (with its trailing slash) instead of
  // 308-redirecting it to `/storybook`. Storybook's HTML references its assets
  // relatively (`./sb-manager/...`), so the document URL must retain the
  // trailing slash for those to resolve under `/storybook/`. This only disables
  // Next's automatic trailing-slash redirect; the app's own routes use
  // canonical (no-trailing-slash) links and are unaffected.
  skipTrailingSlashRedirect: true,
  // Storybook is built into `public/storybook/` on non-production deploys and
  // served as static files. Next.js serves `public/` only by exact file path
  // and does no directory-index resolution, so a request to `/storybook` or
  // `/storybook/` would 404 (the index.html is reachable only at its exact
  // path). Rewrite the directory entry point to that file so the permanent
  // `/storybook/` URL opens Storybook without exposing a per-deploy URL. The
  // rewrite keeps the browser URL unchanged. In production `public/storybook`
  // does not exist, so the target 404s and Storybook stays excluded. All
  // Storybook assets and `iframe.html` use relative/exact paths and already
  // resolve, so only the entry point needs this.
  async rewrites() {
    return [
      { source: '/storybook', destination: '/storybook/index.html' },
      { source: '/storybook/', destination: '/storybook/index.html' },
    ]
  },
};

export default nextConfig;
