"use client";

// Fallback is issued only by ARENA_PREVIEW=1 servers when cookies cannot be used.
// sessionStorage is tab-scoped; when unavailable it remains in memory until navigation.
const KEY = "metra_preview_session";
let token: string | null | undefined;

export function previewToken(): string | null {
  if (token === undefined) {
    try { token = sessionStorage.getItem(KEY); } catch { token = null; }
    if (token && !/^[a-f0-9]{64}$/.test(token)) token = null;
  }
  return token;
}

export function setPreviewToken(value: string | null): boolean {
  token = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
    return true;
  } catch { return false; } // memory-only when storage is blocked
}

export async function sessionFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, window.location.href);
  if (url.origin !== window.location.origin || !(url.pathname.startsWith("/api/") || url.pathname.startsWith("/report/"))) {
    throw new Error("نشانی درخواست معتبر نیست.");
  }
  const headers = new Headers(init.headers);
  const current = previewToken();
  headers.set("x-metra-preview-transport", "1");
  if (current) headers.set("x-metra-preview-session", current);
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (response.ok && url.pathname === "/api/auth" && init.method === "POST") {
    const replacement = response.headers.get("x-metra-preview-session");
    if (current && replacement && /^[a-f0-9]{64}$/.test(replacement)) setPreviewToken(replacement);
    else if (current && !replacement) setPreviewToken(null);
    // If cookies were previously working but the new auth cookie is rejected,
    // preserve the new session for the subsequent verification round trip.
    else if (replacement && /^[a-f0-9]{64}$/.test(replacement)) {
      try {
        const check = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        const result = check.ok ? await check.json() : null;
        const authenticated = await response.clone().json();
        if (result?.userId !== authenticated.user?.id) setPreviewToken(replacement);
      } catch { setPreviewToken(replacement); }
    }
  }
  return response;
}
