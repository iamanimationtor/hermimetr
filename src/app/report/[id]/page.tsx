import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { estimateSnapshots, projects } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { formatPersianDecimal as number } from "@/lib/format";
import { rialToWordsFa } from "@/lib/rial-words";
import { estimateDraftDisclosure } from "@/lib/estimate-disclosure";
import { readCoefficientScenario } from "@/lib/coefficient-scenario";

type FrozenRow = { title: string; unit: string; quantity: string; unitPriceRial: string; amountRial: string;
  priceSource: string; priceDate: string; formula: string; sourceNote: string;
  category?: string | null;
  pricebookSnapshot?: { item: { code: string; conditions: string | null; page: string | null }; edition: { title: string; baseYear: string } } | null };
const date = (value: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(value);
const dateShort = (value: Date) => value.toISOString().slice(0,10);

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
  const p: any = snapshot.projectSnapshot;
  const scenario = readCoefficientScenario(p);
  if ((p.coefficientScenario && !scenario) || (scenario && scenario.directTotalRial !== snapshot.totalRial)) notFound();
  const rows = snapshot.rows as unknown as FrozenRow[];
  const basisName = snapshot.basis === "official" ? "فهرست‌بهای رسمی (با ارجاع پیمان)" : snapshot.basis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد";
  const stageNames: Record<string, string> = { conceptual: "مفهومی", preliminary: "مقدماتی", initial_drawings: "نقشه‌های اولیه", detailed: "تفصیلی", execution_drawings: "نقشه‌های اجرایی", confirmed: "مقادیر تأییدشده" };
  const stageName = stageNames[String(p.stage || "")] || String(p.stage || "—");
  const wordsFa = rialToWordsFa(snapshot.totalRial);

  // Group by category for فصل breakdown
  const groups = new Map<string, { total: string; count: number }>();
  for (const r of rows) {
    const cat = (r as any).category || "سایر";
    const g = groups.get(cat) ?? { total: "0", count: 0 };
    // sum via Decimal-like string add: use BigInt for Rial (integer)
    g.total = (BigInt(g.total) + BigInt(r.amountRial)).toString();
    g.count += 1;
    groups.set(cat, g);
  }

  return <main className="report-page" dir="rtl">
    <div className="report-tools"><Link href="/" className="report-back">بازگشت به فضای کار</Link><PrintButton /></div>

    {/* Professional header */}
    <header className="report-head-detailed">
      <div className="report-head-top">
        <div className="report-brand"><div className="report-mark">م</div><span>مِترا <small>سامانه یکپارچه متره و برآورد — خروجی حرفه‌ای</small></span></div>
        <div className="report-version-badge">نسخه ثابت {number(String(snapshot.version))} · {dateShort(snapshot.createdAt)}</div>
      </div>
      <h1 className="report-project-title">{String(p.name || "پروژه")} <small>{String(p.code || "")}</small></h1>
      <div className="report-project-meta">
        <span>کارفرما: <strong>{String(p.employer || "—")}</strong></span>
        <span>پیمانکار: <strong>{String(p.contractor || "—")}</strong></span>
        <span>مبنای قیمت: <strong>{basisName}</strong></span>
        <span>ارجاع پیمان: <strong>{String(p.contractReference || "—")}</strong></span>
      </div>
      <div className="report-project-meta secondary">
        <span>نشانی: <strong>{[p.province, p.city].filter(Boolean).join("، ") || "—"}</strong></span>
        <span>نوع: <strong>{String(p.type || "—")}</strong></span>
        <span>زیربنا: <strong>{String(p.area || "—")} م²</strong></span>
        <span>مرحله: <strong>{stageName}</strong></span>
        <span>مالی: <strong>{String(p.fundingType === "private" ? "خصوصی" : p.fundingType === "public" ? "عمومی" : p.fundingType === "partnership" ? "مشارکتی" : p.fundingType || "—")}</strong></span>
      </div>
    </header>

    <div className="report-meta pro">
      <div><span>شناسه نسخه</span><strong>{snapshot.id.slice(0,8)}…</strong></div>
      <div><span>تاریخ گزارش</span><strong>{date(snapshot.createdAt)}</strong></div>
      <div><span>تعداد ردیف</span><strong>{number(String(rows.length))}</strong></div>
      <div><span>وضعیت</span><strong>منجمد و قابل حسابرسی</strong></div>
    </div>

    <p className="report-scope-warning pro">{estimateDraftDisclosure(p)}</p>

    {/* فصل breakdown — market requirement */}
    {groups.size > 1 && <>
      <h2>خلاصه به تفکیک فصل / دسته</h2>
      <table className="report-table grouped"><thead><tr><th>فصل / دسته</th><th>تعداد ردیف</th><th>جمع مبلغ (ریال)</th><th>سهم</th></tr></thead><tbody>
        {[...groups.entries()].map(([cat, g]) => <tr key={cat}><td><strong>{cat}</strong></td><td>{number(String(g.count))}</td><td className="report-amount">{number(g.total)}</td><td>{((Number(g.total)/Number(snapshot.totalRial)||0)*100).toFixed(1)}٪</td></tr>)}
        <tr className="group-total"><td><strong>جمع کل</strong></td><td>{number(String(rows.length))}</td><td className="report-amount">{number(snapshot.totalRial)}</td><td>۱۰۰٪</td></tr>
      </tbody></table>
    </>}

    <h2>ریز برآورد — مقادیر و هزینه‌ها با محاسبه دقیق یکپارچه</h2>
    <table className="report-table pro"><thead><tr><th>ردیف</th><th>شرح عملیات و مبانی</th><th>دسته</th><th>واحد</th><th>مقدار</th><th>بهای واحد (ریال)</th><th>مبلغ (ریال)</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={index}><td>{number(String(index + 1))}</td><td className="desc-cell"><strong>{row.title}</strong>
        <small className="desc-meta">فرمول متره: <bdi dir="ltr">{row.formula}</bdi> · منبع مقدار: {row.sourceNote}</small>
        <small className="desc-meta">منبع بها: {row.priceSource} · {row.priceDate} {row.pricebookSnapshot && <>· فهرست‌بها: {row.pricebookSnapshot.edition.title} سال {row.pricebookSnapshot.edition.baseYear} ردیف {row.pricebookSnapshot.item.code}{row.pricebookSnapshot.item.page && ` ص ${row.pricebookSnapshot.item.page}`}{row.pricebookSnapshot.item.conditions && ` — ${row.pricebookSnapshot.item.conditions}`}</>}</small>
      </td><td>{(row as any).category || "—"}</td><td>{row.unit}</td><td dir="ltr">{number(row.quantity)}</td><td dir="ltr">{number(row.unitPriceRial)}</td><td className="report-amount" dir="ltr">{number(row.amountRial)}</td></tr>)}
    </tbody></table>

    <div className="report-total pro">
      <div><span>جمع مستقیم ردیف‌های تأییدشده</span><small>بدون اعمال ضرایب، تعدیل، تجهیز، مالیات، بیمه و کسورات — صرفاً حاصل‌ضرب دقیق مقدار × بهای مستند</small></div>
      <div className="total-amount"><strong>{number(snapshot.totalRial)} <small>ریال</small></strong><span className="words">{wordsFa}</span></div>
    </div>

    {scenario && <section className="report-notes pro"><h2>سناریوی دستی ضرایب — بر کل جمع مستقیم</h2><p>ترتیب و شمول توسط کاربر اعلام و به‌صورت خودکار با گرد نیم‌به‌بالا پس از هر مرحله محاسبه شده است. این بخش تأیید رسمی یا برآورد نهایی پیمان تلقی نمی‌شود.</p><table className="report-table"><thead><tr><th>ترتیب</th><th>عنوان و مبنای اعلام‌شده</th><th>ضریب</th><th>ورودی (ریال)</th><th>خروجی (ریال)</th></tr></thead><tbody>{scenario.steps.map((step, i) => <tr key={i}><td>{number(String(i + 1))}</td><td>{step.label}<small>{step.source}</small></td><td>{number(step.multiplier)}</td><td>{number(step.inputRial)}</td><td>{number(step.outputRial)}</td></tr>)}</tbody></table><div className="report-total"><span>مبلغ سناریوی دستی <small>بدون تعدیل، مالیات، بیمه و کسورات</small></span><strong>{number(scenario.finalTotalRial)} <small>ریال</small></strong></div><p className="words">به حروف: {rialToWordsFa(scenario.finalTotalRial)}</p></section>}

    <section className="report-notes pro"><h2>مبانی، روش محاسبه و محدودیت‌ها</h2>
      <ul className="report-bullets">
        <li>مقادیر با دقت ۴ رقم اعشار و با Decimal ۳۶ محاسبه و فرمول هر ردیف همراه با ابعاد ورودی ثبت شده است.</li>
        <li>مبلغ هر ردیف = مقدار (۴ اعشار) × بهای واحد (۲ اعشار) با گرد نیم‌به‌بالا به ریال؛ جمع کل = مجموع مبالغ ردیف‌ها — بدون تقریب شناور.</li>
        <li>تنها ردیف‌های با وضعیت «تأییدشده»، منبع مقدار ثبت‌شده و بهای هم‌واحد/هم‌مبنا در جمع منظور شده‌اند.</li>
        <li>هیچ ضریب، شاخص تعدیل، تجهیز کارگاه، مالیات، بیمه و کسوراتی به جمع مستقیم اضافه نشده است؛ در صورت نیاز سناریوی دستی بالا را ببینید.</li>
        <li>اعتبار فهرست‌بها منوط به تطبیق شرح کامل ردیف، شرایط و مقدمه فصل با سند رسمی مورد استناد است.</li>
      </ul>
      {snapshot.notes && <p className="report-note-box">یادداشت نسخه: {snapshot.notes}</p>}
      <p className="report-note-box subtle">این گزارش از داده‌های منجمد نسخه {number(String(snapshot.version))} تولید شده و با تغییر داده‌های زنده عوض نمی‌شود. برای حسابرسی، هش و شناسه نسخه در پاورقی آمده است.</p>
    </section>

    {/* Signature block — market essential */}
    <section className="report-signatures">
      <div><span>تهیه‌کننده</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
      <div><span>تأیید فنی / مترور</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
      <div><span>کارفرما / تصویب</span><strong>نام و امضا</strong><small>تاریخ ____ / ____ / ____</small></div>
    </section>

    <footer className="report-footer pro"><span>مِترا · سامانه یکپارچه متره و برآورد · خروجی قابل ارائه در کار حرفه‌ای</span><span>شناسه نسخه: {snapshot.id} · تولید: {dateShort(snapshot.createdAt)} · صفحه &nbsp;<span className="pageNumber"></span></span></footer>
  </main>;
}
