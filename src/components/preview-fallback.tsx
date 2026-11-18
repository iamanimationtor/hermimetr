"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import Image from "next/image";
import { sessionFetch } from "@/lib/client-session";

/** Read-only report, fetched with the tab credential rather than placing it in a URL. */
export function FallbackReport({ url, onClose }: { url: string; onClose: () => void }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void sessionFetch(url, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("گزارش در دسترس نیست؛ نشست و دسترسی پروژه را بررسی کنید.");
      setHtml(await response.text());
    }).catch((failure) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "گزارش بارگذاری نشد."); });
    return () => abort.abort();
  }, [url]);
  return <div className="modal-backdrop document-preview-backdrop" role="dialog" aria-modal="true" aria-label="گزارش چاپی">
    <div className="document-preview">
      <div className="document-preview-header"><div><strong>گزارش چاپی</strong><small>چاپ یا ذخیره PDF از پنجره مرورگر</small></div>
        <div><button type="button" disabled={!html} onClick={() => frame.current?.contentWindow?.print()}><Printer size={18} /> چاپ / ذخیره PDF</button>
          <button type="button" aria-label="بستن گزارش" onClick={onClose}><X size={21} /></button></div></div>
      {error ? <p className="modal-body">{error}</p> : html ? <iframe ref={frame} title="گزارش چاپی" srcDoc={html} sandbox="allow-same-origin allow-modals" /> : <p className="modal-body">در حال بارگذاری گزارش...</p>}
    </div>
  </div>;
}

/** Object URLs are created only after an authenticated same-origin fetch and revoked on close. */
export function FallbackDocument({ id, name, mimeType, onClose }: { id: string; name: string; mimeType: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = "";
    void sessionFetch(`/api/documents?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("سند در دسترس نیست؛ نشست و دسترسی پروژه را بررسی کنید.");
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((failure) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "سند بارگذاری نشد."); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return <div className="modal-backdrop document-preview-backdrop" role="dialog" aria-modal="true" aria-label="پیش‌نمایش سند">
    <div className="document-preview"><div className="document-preview-header"><div><strong>{name}</strong><small>فقط مشاهده</small></div>
      <div>{url && <a href={url} download={name}>دریافت سند</a>}<button type="button" aria-label="بستن سند" onClick={onClose}><X size={21} /></button></div></div>
      {error ? <p className="modal-body">{error}</p> : !url ? <p className="modal-body">در حال بارگذاری سند...</p> : mimeType === "application/pdf"
        ? <iframe title={name} src={url} sandbox="allow-same-origin" />
        : <div className="document-image-wrap"><Image unoptimized width={1400} height={1000} style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} src={url} alt={name} /></div>}
    </div>
  </div>;
}
