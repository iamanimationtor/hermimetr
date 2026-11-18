// Hybrid price bank — official publishers registry
// Only these hosts are considered authoritative for automatic fehrest-baha sync.
// Market/contractor prices remain fully manual by design.

export type Publisher = {
  host: string;
  labelFa: string;
  kind: "official";
  baseUrl: string;
  trustLevel: "primary" | "mirror";
  notesFa: string;
};

export const OFFICIAL_PUBLISHERS: Publisher[] = [
  {
    host: "mporg.ir",
    labelFa: "سازمان برنامه و بودجه کشور",
    kind: "official",
    baseUrl: "https://www.mporg.ir",
    trustLevel: "primary",
    notesFa: "مرجع اصلی فهرست‌بهای ابنیه، راه، تاسیسات و...",
  },
  {
    host: "sama.mporg.ir",
    labelFa: "سامانه ضوابط فنی (ساما)",
    kind: "official",
    baseUrl: "https://sama.mporg.ir",
    trustLevel: "primary",
    notesFa: "انتشار رسمی فهرست‌بها و بخشنامه‌های شاخص",
  },
  {
    host: "tec.mporg.ir",
    labelFa: "معاونت فنی — امور نظام فنی",
    kind: "official",
    baseUrl: "https://tec.mporg.ir",
    trustLevel: "primary",
    notesFa: "ضوابط و دستورالعمل‌های نظام فنی",
  },
];

export const ALLOWED_HOSTS = new Set(OFFICIAL_PUBLISHERS.map((p) => p.host));

export function isAllowedOfficialHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "mporg.ir" || h.endsWith(".mporg.ir");
  } catch {
    return false;
  }
}

export function publisherOf(url: string): Publisher | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return OFFICIAL_PUBLISHERS.find((p) => h === p.host || h.endsWith("." + p.host)) ?? null;
  } catch {
    return null;
  }
}
