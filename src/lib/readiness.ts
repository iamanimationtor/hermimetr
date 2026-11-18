import type { PricingBasis } from "./calculations";

export type ProjectLite = {
  id: string;
  name: string;
  pricingBasis: string;
  contractReference: string | null;
  stage: string;
  isDemo: boolean;
};

export type TakeoffLite = {
  id: string;
  projectId: string;
  title: string;
  quantity: string;
  unit: string;
  status: string;
  isDemo: boolean;
  sourceNote: string | null;
  priceId: string | null;
  pricebookItemId: string | null;
  certainty: string | null;
};

export type PriceLite = {
  id: string;
  unit: string;
  basis: string;
  amount: string;
  currency: string;
  sourceName: string;
  priceDate: string;
  confirmed: boolean;
  referenceId: string | null;
};

export type ReferenceLite = {
  id: string;
  kind: string;
  status: string;
  title: string;
};

export type ValidityLite = Record<string, { state: string }>;

export type ReadinessItem = {
  id: string;
  label: string;
  status: "ok" | "warning" | "blocked";
  detail: string;
  action?: { label: string; view: string };
};

export type ReadinessReport = {
  overall: "ready" | "blocked" | "empty";
  blocked: boolean;
  score: number; // 0-100
  items: ReadinessItem[];
  exportBlockedReason: string | null;
  previewBlockedReasons: string[];
};

export function buildReadiness(
  project: ProjectLite | undefined,
  takeoffs: TakeoffLite[],
  prices: PriceLite[],
  references: ReferenceLite[],
  validity: ValidityLite,
  isOfficialActive: boolean
): ReadinessReport {
  if (!project) {
    return {
      overall: "empty",
      blocked: true,
      score: 0,
      items: [
        {
          id: "project",
          label: "پروژه",
          status: "blocked",
          detail: "پروژه‌ای انتخاب نشده است.",
          action: { label: "ایجاد پروژه", view: "projects" },
        },
      ],
      exportBlockedReason: "پروژه‌ای انتخاب نشده است.",
      previewBlockedReasons: ["پروژه‌ای انتخاب نشده است."],
    };
  }

  const items: ReadinessItem[] = [];
  const previewBlockedReasons: string[] = [];

  // Demo project is always blocked for real estimate
  if (project.isDemo) {
    items.push({
      id: "demo",
      label: "نوع پروژه",
      status: "blocked",
      detail: "این پروژه آموزشی است و برای برآورد واقعی قابل استفاده نیست. پروژه جدید غیرآموزشی بسازید.",
      action: { label: "پروژه‌ها", view: "projects" },
    });
    previewBlockedReasons.push("پروژه آموزشی است.");
  }

  // Official basis requires contract reference and verified pricebook ref
  if ((project.pricingBasis as PricingBasis) === "official") {
    if (!project.contractReference?.trim()) {
      items.push({
        id: "contractRef",
        label: "ارجاع پیمان",
        status: "blocked",
        detail: "مبنای «فهرست‌بهای رسمی» بدون ارجاع صریح به بند پیمان قابل برآورد نیست.",
        action: { label: "ویرایش پروژه", view: "projects" },
      });
      previewBlockedReasons.push("ارجاع پیمان برای مبنای رسمی ثبت نشده است.");
    } else {
      items.push({
        id: "contractRef",
        label: "ارجاع پیمان",
        status: "ok",
        detail: "ارجاع پیمان ثبت شده است.",
      });
    }

    const hasVerifiedPricebookRef = references.some((r) => r.kind === "pricebook" && r.status === "verified");
    if (!hasVerifiedPricebookRef) {
      items.push({
        id: "verifiedRef",
        label: "سند فهرست‌بها",
        status: "blocked",
        detail: "برای مبنای رسمی، حداقل یک سند «فهرست‌بها» با وضعیت «بازبینی کاربر» لازم است.",
        action: { label: "منابع مرجع", view: "references" },
      });
      previewBlockedReasons.push("سند فهرست‌بهای تأییدشده وجود ندارد.");
    } else {
      items.push({
        id: "verifiedRef",
        label: "سند فهرست‌بها",
        status: "ok",
        detail: "سند فهرست‌بهای تأییدشده موجود است.",
      });
    }

    if (!isOfficialActive) {
      items.push({
        id: "editionActive",
        label: "نسخه فهرست‌بها",
        status: "blocked",
        detail: "نسخه فعال فهرست‌بها برای این سال/رشته وجود ندارد. نسخه را فعال کنید.",
        action: { label: "فهرست‌بها", view: "pricebook" },
      });
      previewBlockedReasons.push("نسخه فعال فهرست‌بها موجود نیست.");
    } else {
      items.push({
        id: "editionActive",
        label: "نسخه فهرست‌بها",
        status: "ok",
        detail: "نسخه فعال فهرست‌بها موجود است.",
      });
    }
  }

  // Takeoffs existence
  if (!takeoffs.length) {
    items.push({
      id: "takeoffs",
      label: "متره",
      status: "blocked",
      detail: "هیچ ردیف متره‌ای برای این پروژه ثبت نشده است.",
      action: { label: "متره و مقادیر", view: "takeoff" },
    });
    previewBlockedReasons.push("ردیف متره وجود ندارد.");
  } else {
    const confirmed = takeoffs.filter((t) => t.status === "confirmed" && !["stale", "unusable"].includes(validity[t.id]?.state ?? ""));
    const draft = takeoffs.length - confirmed.length;
    const stale = takeoffs.filter((t) => ["stale", "unusable"].includes(validity[t.id]?.state ?? ""));
    const missingSource = takeoffs.filter((t) => t.status === "confirmed" && !t.sourceNote?.trim());
    const provisional = takeoffs.filter((t) => t.certainty === "provisional" || t.certainty === "blocked");
    const missingPrice = takeoffs.filter((t) => t.status === "confirmed" && !t.priceId);

    if (confirmed.length === 0) {
      items.push({
        id: "confirmed",
        label: "تأیید متره",
        status: "blocked",
        detail: `همه ${takeoffs.length} ردیف در وضعیت پیش‌نویس یا نیازمند بازبینی هستند. حداقل یک ردیف را تأیید کنید.`,
        action: { label: "متره و مقادیر", view: "takeoff" },
      });
      previewBlockedReasons.push("هیچ ردیف تأییدشده‌ای وجود ندارد.");
    } else {
      items.push({
        id: "confirmed",
        label: "تأیید متره",
        status: draft > 0 ? "warning" : "ok",
        detail: `${confirmed.length} از ${takeoffs.length} ردیف تأییدشده است.${draft ? ` ${draft} ردیف پیش‌نویس در برآورد نمی‌آید.` : ""}`,
      });
    }

    if (stale.length > 0) {
      items.push({
        id: "stale",
        label: "بازبینی قاعده",
        status: "blocked",
        detail: `${stale.length} ردیف به قاعده‌ای وابسته است که تغییر کرده یا نامعتبر شده است؛ بازمحاسبه و تأیید مجدد لازم است.`,
        action: { label: "متره و مقادیر", view: "takeoff" },
      });
      previewBlockedReasons.push(`${stale.length} ردیف نیازمند بازبینی قاعده است.`);
    }

    if (missingSource.length > 0) {
      items.push({
        id: "sourceNote",
        label: "منبع مقدار",
        status: "blocked",
        detail: `${missingSource.length} ردیف تأییدشده منبع مقدار ندارد.`,
        action: { label: "متره و مقادیر", view: "takeoff" },
      });
      previewBlockedReasons.push("برخی ردیف‌ها منبع مقدار ندارند.");
    }

    if (provisional.length > 0) {
      items.push({
        id: "provisional",
        label: "قطعیت قاعده",
        status: "blocked",
        detail: `${provisional.length} ردیف با قاعده آزمایشی/تأییدنشده محاسبه شده و در برآورد رسمی نمی‌آید.`,
        action: { label: "متره و مقادیر", view: "takeoff" },
      });
      previewBlockedReasons.push("برخی ردیف‌ها قطعیت کافی ندارند.");
    }

    if (missingPrice.length > 0) {
      items.push({
        id: "missingPrice",
        label: "اتصال بهای واحد",
        status: "blocked",
        detail: `${missingPrice.length} ردیف تأییدشده به بهای واحد متصل نیست.`,
        action: { label: "متره و مقادیر", view: "takeoff" },
      });
      previewBlockedReasons.push("برخی ردیف‌ها به بهای واحد متصل نیستند.");
    }
  }

  // Prices completeness for confirmed takeoffs
  if (takeoffs.length > 0) {
    const confirmedTakeoffs = takeoffs.filter((t) => t.status === "confirmed");
    if (confirmedTakeoffs.length > 0) {
      const priceIds = new Set(confirmedTakeoffs.map((t) => t.priceId).filter(Boolean) as string[]);
      const priceMap = new Map(prices.map((p) => [p.id, p]));
      let badPrices = 0;
      let basisMismatch = 0;
      let unitMismatch = 0;
      for (const tid of priceIds) {
        const p = priceMap.get(tid);
        if (!p) {
          badPrices++;
          continue;
        }
        if (!p.confirmed || !p.sourceName?.trim() || !p.priceDate?.trim()) badPrices++;
        if (p.basis !== project.pricingBasis) basisMismatch++;
        // unit check needs takeoff unit
        const t = takeoffs.find((x) => x.priceId === tid);
        if (t && p.unit !== t.unit) unitMismatch++;
      }
      if (badPrices > 0) {
        items.push({
          id: "priceConfirm",
          label: "تأیید بهای واحد",
          status: "blocked",
          detail: `${badPrices} بهای مرتبط منبع یا تأیید کافی ندارد.`,
          action: { label: "بانک قیمت‌ها", view: "prices" },
        });
        previewBlockedReasons.push("برخی بها تأیید نشده‌اند.");
      }
      if (basisMismatch > 0) {
        items.push({
          id: "priceBasis",
          label: "مبنای قیمت",
          status: "blocked",
          detail: `${basisMismatch} بها مبنای متفاوت با پروژه دارد.`,
          action: { label: "بانک قیمت‌ها", view: "prices" },
        });
        previewBlockedReasons.push("مبنای برخی بها با پروژه متفاوت است.");
      }
      if (unitMismatch > 0) {
        items.push({
          id: "priceUnit",
          label: "واحد بها",
          status: "blocked",
          detail: `${unitMismatch} بها واحد ناهمسان با متره دارد؛ تبدیل واحد انجام نمی‌شود.`,
          action: { label: "متره و مقادیر", view: "takeoff" },
        });
        previewBlockedReasons.push("واحد برخی بها با متره یکسان نیست.");
      }
      if (badPrices === 0 && basisMismatch === 0 && unitMismatch === 0 && priceIds.size > 0) {
        items.push({
          id: "priceOk",
          label: "بهای واحد",
          status: "ok",
          detail: `${priceIds.size} بهای مرتبط تأییدشده و هم‌مبنا است.`,
        });
      }
      if (priceIds.size === 0 && confirmedTakeoffs.length > 0) {
        // already handled as missingPrice
      }
    }
  }

  // Official price needs verified reference link
  if ((project.pricingBasis as PricingBasis) === "official") {
    const linkedOfficial = takeoffs.filter((t) => t.status === "confirmed" && t.priceId).length;
    const verifiedIds = new Set(references.filter((r) => r.kind === "pricebook" && r.status === "verified").map((r) => r.id));
    const priceMap = new Map(prices.map((p) => [p.id, p]));
    let unverifiedLink = 0;
    for (const t of takeoffs.filter((t) => t.status === "confirmed" && t.priceId)) {
      const p = priceMap.get(t.priceId!);
      if (p?.basis === "official" && p.referenceId && !verifiedIds.has(p.referenceId)) unverifiedLink++;
    }
    if (unverifiedLink > 0) {
      items.push({
        id: "officialRefLink",
        label: "پیوند سند رسمی",
        status: "blocked",
        detail: `${unverifiedLink} بهای رسمی به سند تأییدنشده متصل است.`,
        action: { label: "بانک قیمت‌ها", view: "prices" },
      });
      previewBlockedReasons.push("برخی بهای رسمی به سند تأییدنشده متصل است.");
    }
  }

  const blocked = previewBlockedReasons.length > 0;
  const totalChecks = items.length || 1;
  const okCount = items.filter((i) => i.status === "ok").length;
  const warningCount = items.filter((i) => i.status === "warning").length;
  const score = Math.round((okCount + warningCount * 0.5) / totalChecks * 100);

  const exportBlockedReason = blocked
    ? `خروجی نهایی مسدود است: ${previewBlockedReasons[0]} برای رفع، بخش مربوطه را تکمیل کنید.`
    : null;

  return {
    overall: blocked ? "blocked" : takeoffs.length === 0 ? "empty" : "ready",
    blocked,
    score: blocked ? score : 100,
    items,
    exportBlockedReason,
    previewBlockedReasons,
  };
}
