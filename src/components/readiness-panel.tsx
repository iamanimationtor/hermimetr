"use client";

import { buildReadiness, type ProjectLite, type TakeoffLite, type PriceLite, type ReferenceLite, type ValidityLite } from "@/lib/readiness";
import { Badge, PanelTitle } from "./ui";
import { AlertTriangle, CheckCircle2, Info, ArrowLeft } from "lucide-react";

type Props = {
  project?: ProjectLite;
  takeoffs: TakeoffLite[];
  prices: PriceLite[];
  references: ReferenceLite[];
  validity: ValidityLite;
  isOfficialActive: boolean;
  onNavigate: (view: string) => void;
};

export function ReadinessPanel({ project, takeoffs, prices, references, validity, isOfficialActive, onNavigate }: Props) {
  const report = buildReadiness(project, takeoffs, prices, references, validity, isOfficialActive);

  const tone = report.overall === "ready" ? "ok" : report.overall === "blocked" ? "blocked" : "empty";

  return (
    <section className="panel readiness-panel" data-testid="readiness-panel" aria-live="polite">
      <PanelTitle
        title="آمادگی برای خروجی نهایی"
        subtitle={project ? `پروژه: ${project.name} — مبنا: ${project.pricingBasis === "official" ? "فهرست‌بهای رسمی" : project.pricingBasis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد"}` : "پروژه‌ای انتخاب نشده"}
        action={<Badge tone={tone === "ok" ? "green" : tone === "blocked" ? "red" : "neutral"}>{tone === "ok" ? "آماده خروجی" : tone === "blocked" ? "مسدود" : "ناقص"}</Badge>}
      />
      <div className="readiness-score">
        <div className="readiness-bar" aria-hidden>
          <span style={{ width: `${report.score}%` }} className={report.blocked ? "blocked" : "ok"} />
        </div>
        <span className="readiness-percent">{report.score}٪ تکمیل مورد نیاز برای خروجی دقیق</span>
      </div>

      {report.exportBlockedReason && (
        <div className="readiness-block" role="alert">
          <AlertTriangle size={16} /> <p>{report.exportBlockedReason} تا رفع کامل، «ثبت نسخه ثابت» و خروجی اکسل/چاپ بدون برآورد نهایی باقی می‌ماند تا از تولید عدد گمراه‌کننده جلوگیری شود.</p>
        </div>
      )}

      {!report.blocked && report.overall === "ready" && (
        <div className="readiness-ok">
          <CheckCircle2 size={16} /> <p>همه الزامات پایه تکمیل است. پیش‌نمایش برآورد با دقت Decimal و بدون ضریب خودکار به‌روز است و «ثبت نسخه ثابت» اکنون عدد نهایی دقیق را قفل می‌کند.</p>
        </div>
      )}

      <ul className="readiness-list">
        {report.items.map((it) => (
          <li key={it.id} className={`readiness-item ${it.status}`}>
            <span className="readiness-dot" aria-hidden>{it.status === "ok" ? "✓" : it.status === "warning" ? "!" : "×"}</span>
            <div>
              <strong>{it.label}</strong>
              <small>{it.detail}</small>
            </div>
            {it.action && (
              <button className="button button-outline button-sm" onClick={() => onNavigate(it.action!.view)}>
                {it.action.label} <ArrowLeft size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="readiness-note">
        <Info size={14} />
        <p>
          این سیستم یکپارچه هیچ قیمت، فهرست‌بها یا ضریب خودکار تولید نمی‌کند. هر محاسبه فقط با داده‌های تأییدشده شما انجام می‌شود و به‌صورت خودکار پس از هر تغییر (متره، بها، منبع، تطبیق) پیش‌نمایش را به‌روز می‌کند. نسخه‌های ثابت پس از ثبت تغییر نمی‌کنند تا قابلیت حسابرسی حفظ شود؛ هشدار «نسخه جدید قاعده» فقط اطلاع‌رسانی است.
        </p>
      </div>
    </section>
  );
}
