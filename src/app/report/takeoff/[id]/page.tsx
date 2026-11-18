import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects, takeoffItems } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";

type Step = { key: string; label: string; expression: string; substituted: string; value: string };
const number = (value: string | number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 4 }).format(Number(value));
const date = (value: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(value);

export const dynamic = "force-dynamic";

export default async function TakeoffReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, user.id))).limit(1);
  if (!project) notFound();
  const rows = await db.select().from(takeoffItems).where(eq(takeoffItems.projectId, id)).orderBy(asc(takeoffItems.category), asc(takeoffItems.createdAt));
  const status = (row: typeof rows[number]) => row.isDemo ? "آموزشی" : row.status === "confirmed" ? "تأییدشده" : "پیش‌نویس";
  const certainty = (row: typeof rows[number]) => row.certainty === "definitive" ? "ضابطه تأییدشده" : row.certainty === "provisional" ? "آزمایشی — تأییدنشده" : row.certainty === "blocked" ? "مسدود" : row.ruleRef ? "هندسی پایه" : "هندسی پایه (ثبت ساده)";
  const groups = new Map<string, { category: string; unit: string; confirmed: Decimal; draft: Decimal; count: number }>();
  for (const row of rows) {
    const key = `${row.category}|${row.unit}`;
    const group = groups.get(key) ?? { category: row.category, unit: row.unit, confirmed: new Decimal(0), draft: new Decimal(0), count: 0 };
    group.count++;
    if (status(row) === "تأییدشده") group.confirmed = group.confirmed.plus(row.quantity);
    if (status(row) === "پیش‌نویس") group.draft = group.draft.plus(row.quantity);
    groups.set(key, group);
  }
  return <main className="report-page" dir="rtl">
    <div className="report-tools"><Link href="/?view=takeoff" className="report-back">بازگشت به متره</Link><PrintButton /></div>
    <header className="report-head"><div><div className="report-mark">م</div><span>مِترا <small>گزارش مهندسی پروژه</small></span></div><p>گزارش زنده متره · {date(new Date())}</p></header>
    <section className="report-title"><span>ریزمتره و خلاصه متره</span><h1>{project.name}{project.isDemo ? " (آموزشی)" : ""}</h1>
      <p>هر مقدار همراه با قاعده، نسخه قاعده، فرمول با مقادیر و منبع اندازه‌گیری آمده است. این گزارش نسخه ثابت نیست.</p></section>
    <div className="report-meta">
      <div><span>شناسه پروژه</span><strong>{project.code || "ثبت نشده"}</strong></div>
      <div><span>تعداد ردیف</span><strong>{number(rows.length)}</strong></div>
      <div><span>ردیف تأییدشده</span><strong>{number(rows.filter((row) => status(row) === "تأییدشده").length)}</strong></div>
      <div><span>تاریخ مبنای برآورد</span><strong>{project.estimateDate || "ثبت نشده"}</strong></div>
    </div>
    <h2>خلاصه متره</h2>
    <table className="report-table"><thead><tr><th>دسته عملیات</th><th>واحد</th><th>جمع تأییدشده</th><th>جمع پیش‌نویس</th><th>تعداد ردیف</th></tr></thead><tbody>
      {[...groups.values()].map((group) => <tr key={`${group.category}${group.unit}`}><td><strong>{group.category}</strong></td><td>{group.unit}</td>
        <td className="report-amount">{number(group.confirmed.toFixed(4))}</td><td>{number(group.draft.toFixed(4))}</td><td>{number(group.count)}</td></tr>)}
      {!rows.length && <tr><td colSpan={5}>هنوز ردیف متره‌ای ثبت نشده است.</td></tr>}
    </tbody></table>
    <h2 style={{ marginTop: 28 }}>ریزمتره</h2>
    <table className="report-table"><thead><tr><th>ردیف</th><th>شرح، قاعده و محاسبه</th><th>محل</th><th>مقدار</th><th>واحد</th><th>وضعیت</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}><td>{number(index + 1)}</td>
        <td><strong>{row.title}</strong>
          <small>{row.category} · {row.ruleKey ? `قاعده ${row.ruleKey} نسخه ${row.ruleVersion}` : "ثبت ساده هندسی"} · {certainty(row)}</small>
          {row.ruleTrace
            ? (row.ruleTrace as unknown as Step[]).map((step) => <small key={step.key} className="report-step">{step.label}: <bdi dir="ltr">{step.substituted} = {step.value}</bdi></small>)
            : <small className="report-step">فرمول: <bdi dir="ltr">{row.formula}</bdi></small>}
          <small>منبع مقدار: {row.sourceNote || "ثبت نشده"}</small></td>
        <td>{row.floor || "—"}<small>{row.location || ""}</small></td>
        <td className="report-amount">{number(row.quantity)}</td><td>{row.unit}</td><td>{status(row)}</td></tr>)}
    </tbody></table>
    <section className="report-notes"><h2>مبانی و محدودیت‌ها</h2>
      <p>مقادیر «هندسی پایه» حاصل روابط هندسی‌اند و ضابطه پرداخت فهرست‌بها محسوب نمی‌شوند. مقادیر «آزمایشی» با قاعده‌ای محاسبه شده‌اند که سند مرجع یا تأیید متخصص آن کامل نیست و در برآورد قطعی به‌کار نمی‌روند. گرد کردن به روش نیم به بالا تا چهار رقم اعشار انجام شده است.</p></section>
    <footer className="report-footer"><span>مِترا · ابزار مدیریت متره و برآورد</span><span>شناسه پروژه: {project.id}</span></footer>
  </main>;
}
