import { createHash } from "node:crypto";
import { isAllowedOfficialHost } from "./publisher-registry";

export type SyncCheckResult = {
  ok: boolean;
  url: string;
  status?: number;
  remoteHash?: string;
  remoteModified?: string | null;
  etag?: string | null;
  updateAvailable?: boolean;
  messageFa: string;
  detailFa?: string;
};

// In the Arena sandbox outbound is restricted to github/npm/pypi.
// We implement a best-effort fetch that gracefully degrades and never fabricates official data.
// If fetch is blocked, we return a clear message and keep manual import as the reliable path.

export async function checkOfficialSource(url: string, previous?: { hash?: string | null; etag?: string | null }): Promise<SyncCheckResult> {
  if (!url?.trim()) {
    return { ok: false, url, messageFa: "نشانی منبع رسمی ثبت نشده است.", detailFa: "برای فعال‌سازی به‌روزرسانی خودکار، در «منابع مرجع» سند فهرست‌بها را با URL رسمی (mporg.ir) ثبت و تأیید کنید." };
  }
  if (!isAllowedOfficialHost(url)) {
    return { ok: false, url, messageFa: "دامنه منبع مجاز نیست.", detailFa: "فقط دامنه‌های رسمی mporg.ir برای به‌روزرسانی خودکار فهرست‌بها پذیرفته می‌شوند." };
  }

  // Try lightweight HEAD first
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow", headers: previous?.etag ? { "If-None-Match": previous.etag } : {} } as RequestInit);
    clearTimeout(t);

    if (res.status === 304) {
      return { ok: true, url, status: 304, remoteHash: previous?.hash ?? undefined, etag: previous?.etag ?? null, updateAvailable: false, messageFa: "نسخه رسمی تغییری نکرده است.", detailFa: "منبع رسمی همان نسخه قبلی را برمی‌گرداند (304)." };
    }
    if (!res.ok) {
      // Network may be blocked in sandbox — surface as warning, not error that blocks UX
      return { ok: false, url, status: res.status, messageFa: `بررسی خودکار با خطای ${res.status} مواجه شد.`, detailFa: "در این محیطِ پیش‌نمایش، دسترسی به دامنه رسمی ممکن است محدود باشد؛ ورود دستی CSV/XLSX همچنان معتبر است." };
    }
    const etag = res.headers.get("etag");
    const lastMod = res.headers.get("last-modified");
    // If we have HEAD only, we cannot hash body — use ETag/last-modified as proxy
    if (etag && previous?.etag && etag === previous.etag) {
      return { ok: true, url, etag, remoteModified: lastMod, updateAvailable: false, messageFa: "نسخه رسمی بدون تغییر است.", detailFa: `ETag یکسان: ${etag.slice(0, 32)}` };
    }
    if (!etag && !lastMod) {
      return { ok: true, url, etag: null, remoteModified: null, updateAvailable: undefined, messageFa: "منبع در دسترس است اما نشانه نسخه ندارد.", detailFa: "برای تشخیص نسخه جدید، فایل را دانلود و هش محاسبه می‌شود؛ در صورت نیاز ورود دستی انجام دهید." };
    }
    // Conservative: any new ETag/modified is treated as potential update — user must confirm content diff
    const updateAvailable = !!(etag && etag !== previous?.etag) || !!(lastMod && lastMod !== previous?.hash);
    return { ok: true, url, etag, remoteModified: lastMod, updateAvailable, messageFa: updateAvailable ? "نسخه جدید احتمالی در منبع رسمی شناسایی شد." : "وضعیت منبع رسمی بررسی شد.", detailFa: lastMod ? `Last-Modified: ${lastMod}` : etag ? `ETag: ${etag.slice(0, 40)}` : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch failed") || msg.includes("aborted") || msg.includes("ENOTFOUND") || msg.includes("fetch")) {
      return { ok: false, url, messageFa: "در این محیط امکان اتصال مستقیم به منبع رسمی وجود ندارد.", detailFa: "به‌روزرسانی خودکار در حالت آفلاینِ پیش‌نمایش به ورود دستی CSV/XLSX متکی است؛ هش و زمان بررسی ثبت شد." };
    }
    return { ok: false, url, messageFa: "بررسی خودکار ناموفق بود.", detailFa: msg.slice(0, 180) };
  }
}

export function hashBuffer(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function describeSyncErrorFa(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}
