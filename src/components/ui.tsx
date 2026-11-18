"use client";

import type { ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { sessionFetch } from "@/lib/client-session";

const DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Formats a plain decimal string with Persian digits and separators without going through floating point. */
export function fa(value: string | number | null | undefined, maxDecimals = 2): string {
  const raw = String(value ?? "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return "—";
  const [whole, fraction] = raw.split(".");
  const formatted = new Intl.NumberFormat("fa-IR").format(BigInt(whole));
  const decimals = fraction?.slice(0, maxDecimals).replace(/0+$/, "");
  return decimals ? `${formatted}٫${decimals.replace(/\d/g, (digit) => DIGITS[Number(digit)])}` : formatted;
}

export function dateFa(value: string | null | undefined): string {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); } catch { return "—"; }
}

export type Tone = "neutral" | "green" | "orange" | "blue" | "red";
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

export function Empty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={25} strokeWidth={1.7} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ eyebrow, title, size = "md", busy, onClose, children, footer }: {
  eyebrow: string; title: string; size?: "md" | "lg" | "xl"; busy?: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className={`modal-panel ${size === "lg" ? "modal-wide" : size === "xl" ? "modal-xl" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header">
        <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
        <button type="button" className="modal-close" aria-label="بستن" onClick={onClose}><X size={21} /></button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </section>
  </div>;
}

export type ApiResult<T> = { ok: boolean; status: number; data: Partial<T> & { error?: string; errors?: string[] } };

/** Thin fetch wrapper that keeps the HTTP status so callers can react to conflicts (409) and validation errors. */
export async function callApi<T = Record<string, unknown>>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await sessionFetch(path, {
      method, cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "ارتباط با سرور برقرار نشد." } as ApiResult<T>["data"] };
  }
}
