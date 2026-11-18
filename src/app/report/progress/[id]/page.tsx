import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { estimateSnapshots, progressReports, projects } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { formatPersianDecimal as number } from "@/lib/format";

type ProgressRow = { takeoffId: string; title: string; unit: string; estimatedQuantity: string; unitPriceRial: string; previousQuantity: string; currentQuantity: string; periodQuantity: string; previousAmountRial: string; cumulativeAmountRial: string; periodAmountRial: string; evidence: string };
type ProgressTotals = { previousRial: string; cumulativeRial: string; periodRial: string; baselineRial: string };
const date = (value: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(value);
export const dynamic = "force-dynamic";

export default async function ProgressReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [found] = await db.select({ report: progressReports, snapshot: estimateSnapshots, project: projects })
    .from(progressReports).innerJoin(estimateSnapshots, eq(progressReports.snapshotId, estimateSnapshots.id))
    .innerJoin(projects, eq(estimateSnapshots.projectId, projects.id))
    .where(and(eq(progressReports.id, id), eq(projects.ownerId, user.id))).limit(1);
  if (!found) notFound();
  const report = found.report; const snapshot = found.snapshot; const project = found.project;
  const rows = report.rows as unknown as ProgressRow[]; const totals = report.totals as unknown as ProgressTotals;
  const voided = !!report.voidedAt;
  return <main className="report-page" dir="rtl">
    <div className="report-tools"><Link href={`/?view=progress`} className="report-back">بازگشت به پیشرفت کار</Link><PrintButton /></div>
    <header className="report-head"><div><div className="report-mark">م</div><span>مِترا <small>گزارش پیشرفت مقادیر</small></span></div><p>دوره: {report.period} · توالی {number(String(report.sequence))} {voided ? "· باطل شده" : "· معتبر"}</p></header>
    <section className="report-title"><span>پیشرفت تجمعی بر اساس نسخه ثابت</span><h1>{String(project.name)} — نسخه برآورد {number(String(snapshot.version))}</h1><p>مبنا: جمع مستقیم {number(snapshot.totalRial)} ریال در برآورد نسخه {snapshot.version}؛ مقادیر تجمعی وارد شده و مبالغ دوره از تفاضل مبالغ تجمعی گرد شده به ریال (نیم به بالا) محاسبه شده‌اند. این گزارش صورت‌وضعیت قراردادی نیست.</p></section>
    <div className="report-meta"><div><span>شناسه پروژه</span><strong>{project.code || "ثبت نشده"}</strong></div><div><span>تاریخ گزارش</span><strong>{date(report.createdAt)}</strong></div><div><span>وضعیت</span><strong>{voided ? `باطل شده · ${report.voidReason}` : "معتبر"}</strong></div><div><span>مبنای قیمت</span><strong>{snapshot.basis === "official" ? "فهرست‌بهای رسمی" : snapshot.basis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد"}</strong></div></div>
    {voided && <p className="report-scope-warning">این گزارش باطل شده است؛ مقادیر آن در محاسبه پیشرفت لحاظ نمی‌شود و آخرین گزارش معتبر مبنای ادامه است. دلیل: {report.voidReason}</p>}
    <p className="report-scope-warning">این گزارش فقط پیشرفت مقداری را نشان می‌دهد؛ تعدیل، مالیات، بیمه، کسورات و تحویل مالی قطعی در چارچوب دیگر محاسبه می‌شوند. هر مقدار برای واحد «عدد» باید صحیح باشد و از مقدار برآورد بیشتر نباشد.</p>
    <h2>ریز پیشرفت دوره</h2>
    <table className="report-table"><thead><tr><th>ردیف</th><th>شرح عملیات</th><th>برآورد</th><th>قبلی (تجمعی)</th><th>فعلی (تجمعی)</th><th>دوره</th><th>منبع / اندازه‌گیری</th></tr></thead><tbody>
      {rows.map((row, i) => <tr key={row.takeoffId}><td>{number(String(i + 1))}</td><td><strong>{row.title}</strong><small>واحد {row.unit} · بها {number(row.unitPriceRial)} ریال</small></td><td>{number(row.estimatedQuantity)}</td><td>{number(row.previousQuantity)}</td><td>{number(row.currentQuantity)}</td><td>{number(row.periodQuantity)}</td><td><small>{row.evidence || "—"}</small></td></tr>)}
    </tbody></table>
    <h2 style={{ marginTop: 24 }}>خلاصه مالی دوره (بر اساس مبالغ گرد شده ردیف‌ها)</h2>
    <table className="report-table"><thead><tr><th>عنوان</th><th>مبلغ (ریال)</th></tr></thead><tbody>
      <tr><td>جمع برآورد مبنا</td><td className="report-amount">{number(totals.baselineRial)}</td></tr>
      <tr><td>تجمعی تا دوره قبل</td><td className="report-amount">{number(totals.previousRial)}</td></tr>
      <tr><td>تجمعی تا این دوره</td><td className="report-amount">{number(totals.cumulativeRial)}</td></tr>
      <tr><td><strong>مبلغ این دوره</strong></td><td className="report-amount"><strong>{number(totals.periodRial)}</strong></td></tr>
    </tbody></table>
    <div className="report-total"><span>مبلغ دوره {report.period} <small>بدون تعدیل، مالیات، بیمه و کسورات</small></span><strong>{number(totals.periodRial)} <small>ریال</small></strong></div>
    <section className="report-notes"><h2>مبانی و محدودیت‌ها</h2><p>مبالغ از حاصل‌ضرب مقدار تجمعی در بهای واحد نسخه مبنا و گرد کردن هر ردیف به ریال (نیم به بالا) به‌دست آمده است؛ جمع‌ها از جمع همان مبالغ گرد شده محاسبه شده‌اند. مقادیر «عدد» باید صحیح باشند. هر گزارش تنها نسبت به آخرین گزارش معتبر سنجیده می‌شود؛ گزارش باطل شده کنار گذاشته می‌شود. این گزارش جایگزین بررسی فنی، تأیید مهندس ناظر یا توافق قراردادی نیست.</p>{report.notes && <p>یادداشت دوره: {report.notes}</p>}</section>
    <footer className="report-footer"><span>مِترا · ابزار مدیریت متره و برآورد</span><span>شناسه گزارش: {report.id} · نسخه مبنا: {snapshot.id}</span></footer>
  </main>;
}
