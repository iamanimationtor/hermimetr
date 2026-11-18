import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP nonce in the Next.js 16 Proxy convention.
 *
 * App Router injects inline RSC flight scripts, so a strict script-src needs a per-request nonce.
 * Proxy forwards it to the root layout via a request header; the layout sets it on <html>,
 * which makes Next.js add the same nonce to framework-generated scripts.
 */
function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const baseCsp = [
  "default-src 'self'",
  process.env.ARENA_PREVIEW === "1" ? "img-src 'self' blob:" : "img-src 'self'",
  ...(process.env.ARENA_PREVIEW === "1" ? ["frame-src 'self' blob:"] : []),
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  process.env.ARENA_PREVIEW === "1"
    ? "frame-ancestors 'self' https://arena.ai https://*.arena.ai https://*.e2b.app"
    : "frame-ancestors 'none'", 
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
];

export function proxy(request: NextRequest) {
  // Authenticated project PDFs/images must be frameable by our own origin, never by other sites.
  // Only this file endpoint has a sandboxed, same-origin framing policy; all HTML remains unframeable.
  if (request.nextUrl.pathname === "/api/documents") {
    const ancestors = process.env.ARENA_PREVIEW === "1"
      ? "'self' https://arena.ai https://*.arena.ai https://*.e2b.app"
      : "'self'";
    return NextResponse.next({ headers: { "Content-Security-Policy": `default-src 'none'; frame-ancestors ${ancestors}; sandbox allow-same-origin` } });
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-metra-nonce", nonce);

  const responseHeaders = new Headers();
  // Per-user data and nonce-bearing HTML must not be stored in shared CDN caches.
  responseHeaders.set("cache-control", "private, no-store");
  // Inline style attributes require style-src 'unsafe-inline'; script-src stays nonce-only.
  responseHeaders.set(
    "content-security-policy",
    [`script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline'", ...baseCsp].join("; "),
  );
  return NextResponse.next({ request: { headers: requestHeaders }, headers: responseHeaders });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|ttf|woff2?)$).*)"],
};
