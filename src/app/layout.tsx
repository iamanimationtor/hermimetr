import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/vazirmatn/800.css";
import "./globals.css";
import "./rules.css";

export const metadata: Metadata = {
  title: "مِترا | فضای کار متره و برآورد",
  description: "فضای کار فارسی برای مدیریت پروژه، متره هندسی مستند، بانک قیمت و برآورد نسخه‌دار ساختمانی.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce is set by src/proxy.ts and forwarded as a request header.
  // Passing it to <html> makes Next.js apply the nonce to every framework-generated inline
  // script (RSC flight payload), which is required by the strict script-src policy.
  const nonce = (await headers()).get("x-metra-nonce") ?? undefined;
  return <html lang="fa" dir="rtl" nonce={nonce}><body>{children}</body></html>;
}
