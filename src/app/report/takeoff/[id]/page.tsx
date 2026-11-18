import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects, takeoffItems } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { formatPersianDecimal as number } from "@/lib/format";
import { assessRows, loadRuleBank } from "@/lib/rules/server";

type Step = { key: string; label: string; expression: string; substituted: string; value: string };
const date = (value: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(value);
const dateShort = (value: Date) => value.toISOString().slice(0,10);

export const dynamic = "force-dynamic";

export default async function TakeoffReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, user.id))).limit(1);
  if (!project) notFound();
  const rows = await db.select().from(takeoffItems).where(eq(takeoffItems.projectId, id)).orderBy(asc(takeoffItems.category), asc(takeoffItems.createdAt));
  const validity = assessRows(rows, (await loadRuleBank(user.id)).bank);
  const status = (row: typeof rows[number]) => row.isDemo ? "آموزشی"
    : row.status === "confirmed" && ["stale", "unusable"].includes(validity[row.id]?.state) ? "نیازمند بازبینی"
    : row.status === "confirmed" ? "تأییدشده" : "پیش‌نویس";
  const certainty = (row: typeof rows[number]) => row.certainty === "definitive" ? "ضابطه تأییدشده" : row.certainty === "provisional" ? "آزمایشی — تأییدنشده" : row.certainty === "blocked" ? "مسدود" : row.ruleRef ? "هندسی پایه" : "هندسی پایه (ثبت ساده)";
  const groups = new Map<string, { category: string; unit: string; confirmed: Decimal; draft: Decimal; count: number }>();
  for (const row of rows) {
    const key = JSON.stringify([row.category, row.unit]);
    const group = groups.get(key) ?? { category: row.category, unit: row.unit, confirmed: new Decimal(0), draft: new Decimal(0), count: 0 };
    group.count++;
    if (status(row) === "تأییدشده") group.confirmed = group.confirmed.plus(row.quantity);
    if (status(row) === "پیش‌نویس") group.draft = group.draft.plus(row.quantity);
    groups.set(key, group);
  }
  return <main className="report-page" dir="rtl">
    <div className="report-tools"><Link href="/?view=takeoff" className="report-back">بازگشت به متره</Link><PrintButton /></div>
    <header className="report-head-detailed">
      <div className="report-head-top">
        <div className="report-brand"><div className="report-mark">م</div><span>مِترا <small>گزارش مهندسی پروژه — ریزمتره دقیق</small></span></div>
        <div className="report-version-badge">گزارش زنده · {dateShort(new Date())}</div>
      </div>
      <h1 className="report-project-title">{project.name}{project.isDemo ? " (آموزشی)" : ""} <small>{project.code || ""}</small></h1>
      <div className="report-project-meta">
        <span>کارفرما: <strong>{project.employer || "—"}</strong></span>
        <span>پیمانکار: <strong>{project.contractor || "—"}</strong></span>
        <span>موقعیت: <strong>{[project.province, project.city].filter(Boolean).join("، ") || "—"}</strong></span>
        <span>نوع: <strong>{project.type}</strong></span>
      </div>
      <div className="report-project-meta secondary">
        <span>زیربنا: <strong>{project.area || "—"} م²</strong></span>
        <span>طبقات/زیرزمین: <strong>{project.floors}/{project.basements}</strong></span>
        <span>تاریخ مبنا: <strong>{project.estimateDate || "—"}</strong></span>
        <span>مبنای قیمت: <strong>{project.pricingBasis === "official" ? "فهرست‌بها" : project.pricingBasis === "contractor" ? "پیمانکار" : "بازار"}</strong></span>
      </div>
    </header>
    <div className="report-meta pro">
      <div><span>شناسه پروژه</span><strong>{project.code || "ثبت نشده"}</strong></div>
      <div><span>کل ردیف</span><strong>{number(rows.length)}</strong></div>
      <div><span>تأییدشده</span><strong>{number(rows.filter((row) => status(row) === "تأییدشده").length)}</strong></div>
      <div><span>دقت</span><strong>۴ رقم اعشار · نیم‌به‌بالا</strong></div>
    </div>
    <h2>خلاصه متره به تفکیک دسته و واحد</h2>
    <table className="report-table grouped"><thead><tr><th>دسته عملیات</th><th>واحد</th><th>جمع تأییدشده</th><th>جمع پیش‌نویس</th><th>تعداد</th></tr></thead><tbody>
      {[...groups.values()].map((group) => <tr key={`${group.category}${group.unit}`}><td><strong>{group.category}</strong></td><td>{group.unit}</td>
        <td className="report-amount">{number(group.confirmed.toFixed(4))}</td><td>{number(group.draft.toFixed(4))}</td><td>{number(group.count)}</td></tr>)}
      {!rows.length && <tr><td colSpan={5}>هنوز ردیف متره‌ای ثبت نشده است.</td></tr>}
    </tbody></table>
    <h2 style={{ marginTop: 28 }}>ریزمتره — مقادیر دقیق با فرمول و منبع</h2>
    <table className="report-table pro"><thead><tr><th>ردیف</th><th>شرح، قاعده و محاسبه</th><th>طبقه / محل</th><th>مقدار</th><th>واحد</th><th>وضعیت</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}><td>{number(index + 1)}</td>
        <td className="desc-cell"><strong>{row.title}</strong>
          <small className="desc-meta">{row.category} · {row.ruleKey ? `قاعده ${row.ruleKey} نسخه ${row.ruleVersion}` : "ثبت ساده هندسی"} · {certainty(row)}</small>
          {row.ruleTrace
            ? (row.ruleTrace as unknown as Step[]).map((step) => <small key={step.key} className="report-step">{step.label}: <bdi dir="ltr">{step.substituted} = {step.value}</bdi></small>)
            : <small className="report-step">فرمول: <bdi dir="ltr">{row.formula}</bdi></small>}
          <small>منبع مقدار: {row.sourceNote || "ثبت نشده"} {row.documentId ? "· دارای پیوست" : ""}</small></td>
        <td>{row.floor || "—"}<small>{row.location || ""}</small></td>
        <td className="report-amount" dir="ltr">{number(row.quantity)}</td><td>{row.unit}</td><td><span className={`status-badge ${status(row)==="تأییدشده" ? "ok":"warn"}`}>{status(row)}</span></td></tr>)}
    </tbody></table>
    <section className="report-notes pro"><h2>مبانی و دقت محاسبه</h2>
      <ul className="report-bullets">
        <li>تمام مقادیر با Decimal ۳۶ و گرد نیم‌به‌بالا تا ۴ رقم اعشار محاسبه شده و فرمول با مقادیر واقعی ثبت است.</li>
        <li>ردیف‌های آموزشی و نیازمند بازبینی از جمع تأییدشده کنار گذاشته شده‌اند؛ «هندسی پایه» ضابطه پرداخت فهرست‌بها نیست.</li>
        <li>منبع هر مقدار (نقشه/محل) و پیوست فایل در ستون مربوطه قابل ردیابی است.</li>
      </ul>
    </section>
    <section className="report-signatures">
      <div><span>مترور / تهیه‌کننده</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
      <div><span>تأیید فنی</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
      <div><span>کارفرما</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
    </section>
    <footer className="report-footer pro"><span>مِترا · گزارش زنده متره — نسخه ثابت نیست، پیش از برآورد تأیید شود</span><span>شناسه پروژه: {project.id.slice(0,8)}…</span></footer>
  </main>;
}
