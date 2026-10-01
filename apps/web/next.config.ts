import type { NextConfig } from "next";

import { resolveWebBuildRoot } from "./src/lib/build-root";
import { validateProductionWebEnvironment } from "./src/lib/production-env";

validateProductionWebEnvironment();

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

const privateHeaders = [
  ...securityHeaders,
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const buildRoot = resolveWebBuildRoot(process.cwd());

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: buildRoot,
  turbopack: {
    root: buildRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      ...[
        "/app/:path*",
        "/clinician/:path*",
        "/shared/:path*",
        "/api/shared/:path*",
        "/scan/:path*",
        "/api/scan/:path*",
      ].map((source) => ({ source, headers: privateHeaders })),
    ];
  },
};

export default nextConfig;
