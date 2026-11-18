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

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwardedProto === "https" || request.nextUrl.protocol === "https:";
}

const baseCsp = [
  "default-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

export function proxy(request: NextRequest) {
  // Authenticated project PDFs/images must be frameable by our own origin, never by other sites.
  // Only this file endpoint has a sandboxed, same-origin framing policy; all HTML remains unframeable.
  if (request.nextUrl.pathname === "/api/documents") {
    return NextResponse.next({ headers: { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox allow-same-origin" } });
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-metra-nonce", nonce);

  const responseHeaders = new Headers();
  // Inline style attributes require style-src 'unsafe-inline'; script-src stays nonce-only.
  // upgrade-insecure-requests is added only when the request really arrived over HTTPS:
  // on a plain-HTTP deployment it would rewrite every script/asset URL to https://,
  // the bundle would never load, and the app would stay on its loading screen with no error.
  responseHeaders.set(
    "content-security-policy",
    [
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      ...baseCsp,
      ...(isHttpsRequest(request) ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  );
  return NextResponse.next({ request: { headers: requestHeaders }, headers: responseHeaders });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|ttf|woff2?)$).*)"],
};
