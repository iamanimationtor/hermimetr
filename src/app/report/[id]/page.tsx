import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { estimateSnapshots, projects } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";

type FrozenRow = { title: string; unit: string; quantity: string; unitPriceRial: string; amountRial: string;
  priceSource: string; priceDate: string; formula: string; sourceNote: string };
const number = (value: string) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 4 }).format(Number(value));
const date = (value: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(value);

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [found] = await db.select({ snapshot: estimateSnapshots }).from(estimateSnapshots)
    .innerJoin(projects, eq(estimateSnapshots.projectId, projects.id))
    .where(and(eq(estimateSnapshots.id, id), eq(projects.ownerId, user.id))).limit(1);
  if (!found) notFound();
  const snapshot = found.snapshot;
  const p = snapshot.projectSnapshot;
  const rows = snapshot.rows as unknown as FrozenRow[];
  const basisName = snapshot.basis === "official" ? "فهرست‌بهای ثبت‌شده" : snapshot.basis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد";
  const stageNames: Record<string, string> = { conceptual: "مفهومی", preliminary: "مقدماتی", initial_drawings: "نقشه‌های اولیه",
    detailed: "تفصیلی", execution_drawings: "نقشه‌های اجرایی", confirmed: "مقادیر تأییدشده" };
  const stageName = stageNames[String(p.stage || "")] || String(p.stage || "—");
  return <main className="report-page" dir="rtl">
    <div className="report-tools"><Link href="/" className="report-back">بازگشت به فضای کار</Link><PrintButton /></div>
    <header className="report-head"><div><div className="report-mark">م</div><span>مِترا <small>گزارش مهندسی پروژه</small></span></div><p>نسخه ثابت شماره {number(String(snapshot.version))}</p></header>
    <section className="report-title"><span>گزارش برآورد هزینه</span><h1>{String(p.name || "پروژه")}</h1><p>خروجی مبتنی بر ردیف‌های تأییدشده، منابع ثبت‌شده و داده‌های منجمدشده هنگام ایجاد نسخه</p></section>
    <div className="report-meta">
      <div><span>شناسه پروژه</span><strong>{String(p.code || "ثبت نشده")}</strong></div>
      <div><span>مبنای قیمت</span><strong>{basisName}</strong></div>
      <div><span>تاریخ گزارش</span><strong>{date(snapshot.createdAt)}</strong></div>
      <div><span>مرحله برآورد</span><strong>{stageName}</strong></div>
    </div>
    <h2>ریز برآورد</h2>
    <table className="report-table"><thead><tr><th>ردیف</th><th>شرح عملیات</th><th>واحد</th><th>مقدار</th><th>بهای واحد (ریال)</th><th>مبلغ (ریال)</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={index}><td>{number(String(index + 1))}</td><td><strong>{row.title}</strong><small>فرمول: {row.formula}<br />منبع مقدار: {row.sourceNote}<br />منبع بها: {row.priceSource} · {row.priceDate}</small></td><td>{row.unit}</td><td>{number(row.quantity)}</td><td>{number(row.unitPriceRial)}</td><td className="report-amount">{number(row.amountRial)}</td></tr>)}
    </tbody></table>
    <div className="report-total"><span>جمع مستقیم ردیف‌ها <small>بدون اعمال ضرایب، مالیات و کسورات</small></span><strong>{number(snapshot.totalRial)} <small>ریال</small></strong></div>
    <section className="report-notes"><h2>مبانی و محدودیت‌ها</h2><p>این گزارش تنها حاصل ضرب مقادیر هندسی تأییدشده در بهای واحد مستندِ انتخاب‌شده است. شمول قواعد اختصاصی فهرست‌بها، ضرایب پیمان، تجهیز کارگاه، تعدیل، بیمه، مالیات و کسورات در این نسخه محاسبه نشده است. برای استفاده قراردادی، منابع و دامنه شمول باید توسط کارشناس ذی‌صلاح بازبینی شوند.</p>{snapshot.notes && <p>یادداشت نسخه: {snapshot.notes}</p>}</section>
    <footer className="report-footer"><span>مِترا · ابزار مدیریت متره و برآورد</span><span>شناسه نسخه: {snapshot.id}</span></footer>
  </main>;
}
