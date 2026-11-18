import type { NextConfig } from "next";

/**
 * Global security headers applied to every route.
 *
 * The Content-Security-Policy is set in src/proxy.ts instead of here because it must carry
 * a per-request nonce: Next.js App Router injects its own inline <script> tags (RSC flight
 * payload), which a static strict `script-src 'self'` would block. The proxy generates a
 * nonce per request, adds it to script-src and to the framework's inline scripts via
 * <html nonce={...}>. The remaining static headers live here.
 *
 * The app loads no external subresources (fonts via @fontsource, file previews from
 * /api/documents), so the strict same-origin policy is safe in production.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The embedded Arena preview needs framing; ordinary deployments remain unframeable.
  ...(process.env.ARENA_PREVIEW === "1" ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Project PDFs are displayed in our authenticated, same-origin preview iframe.
      // Keep all other pages unframeable; only this file endpoint may be framed by us.
      ...(process.env.ARENA_PREVIEW === "1" ? [] : [
        { source: "/api/documents", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      ]),
    ];
  },
};

export default nextConfig;
