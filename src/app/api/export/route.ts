import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { estimateSnapshots, projects } from "@/db/schema";
import { ApiError, apiFailure, requiredUser, uuid } from "@/lib/api";
import { estimateDraftDisclosure } from "@/lib/estimate-disclosure";
import { readCoefficientScenario } from "@/lib/coefficient-scenario";

type FrozenRow = { title: string; unit: string; quantity: string; unitPriceRial: string; amountRial: string;
  priceSource: string; priceDate: string; formula: string; sourceNote: string; referenceId: string | null;
  pricebookSnapshot?: { item: { code: string; conditions: string | null; page: string | null }; edition: { title: string; baseYear: string } } | null };

const safeCsv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const url = new URL(request.url);
    const projectId = uuid.parse(url.searchParams.get("projectId"));
    const format = z.enum(["xlsx", "csv", "json"]).parse(url.searchParams.get("format"));
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id))).limit(1);
    if (!project) throw new ApiError("پروژه یافت نشد.", 404);
    const requestedId = url.searchParams.get("snapshotId");
    const [snapshot] = requestedId
      ? await db.select().from(estimateSnapshots).where(and(eq(estimateSnapshots.projectId, projectId), eq(estimateSnapshots.id, uuid.parse(requestedId)))).limit(1)
      : await db.select().from(estimateSnapshots).where(eq(estimateSnapshots.projectId, projectId)).orderBy(desc(estimateSnapshots.version)).limit(1);
    if (!snapshot) throw new ApiError("ابتدا یک نسخه برآورد ثبت کنید.", 404);
    const rows = snapshot.rows as unknown as FrozenRow[];
    const scenario = readCoefficientScenario(snapshot.projectSnapshot);
    if (scenario && scenario.directTotalRial !== snapshot.totalRial) throw new ApiError("مبنای سناریوی ضرایب با نسخه ذخیره‌شده ناسازگار است.", 409);
    if (snapshot.projectSnapshot.coefficientScenario && !scenario) throw new ApiError("سناریوی ذخیره‌شده معتبر نیست؛ خروجی متوقف شد.", 409);
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (format === "json") return new Response(JSON.stringify({ snapshot }, null, 2),
      { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="metra-v${snapshot.version}.json"` } });
    if (format === "csv") {
      const lines = [
        ["ردیف", "شرح", "واحد", "مقدار", "بهای واحد (ریال)", "مبلغ (ریال)", "منبع قیمت", "تاریخ قیمت", "فرمول متره", "منبع مقدار"].map(safeCsv).join(","),
        ...rows.map((row, index) => [index + 1, row.title, row.unit, row.quantity, row.unitPriceRial, row.amountRial,
          row.priceSource, row.priceDate, row.formula, row.sourceNote].map(safeCsv).join(",")),
        ["", "جمع مستقیم ردیف‌ها (بدون ضریب و مالیات)", "", "", "", snapshot.totalRial].map(safeCsv).join(","),
        ["", estimateDraftDisclosure(snapshot.projectSnapshot)].map(safeCsv).join(","),
        ...(scenario ? [
          ["سناریوی دستی ضرایب", "ترتیب اعمال", "ضریب", "ورودی (ریال)", "خروجی (ریال)", "مبنای اعلام‌شده"].map(safeCsv).join(","),
          ...scenario.steps.map((step, index) => [step.label, index + 1, step.multiplier, step.inputRial, step.outputRial, step.source].map(safeCsv).join(",")),
          ["مبلغ سناریوی دستی (ریال)", scenario.finalTotalRial, "گرد کردن نیم به بالا در هر مرحله؛ بر کل جمع مستقیم"].map(safeCsv).join(","),
          ["محدودیت", "اعمال دستی؛ صحت، شمول و ترتیب ضرایب تأیید مستقل نشده است. تعدیل، مالیات، بیمه و کسورات محاسبه نشده‌اند."].map(safeCsv).join(","),
        ] : []),
      ];
      return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="metra-v${snapshot.version}.csv"` } });
    }
    const excelSafe = (value: string) => {
      const decimal = new Decimal(value);
      if (decimal.abs().gte("1000000000000000") || decimal.sd() > 15) throw new ApiError("عدد از محدوده دقت عددی اکسل فراتر است؛ از JSON یا CSV استفاده کنید.");
      return Number(value);
    };
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Metra | مترا";
    workbook.created = snapshot.createdAt;
    workbook.calcProperties.fullCalcOnLoad = true; // Excel recomputes every formula on open instead of trusting cached values
    const sheet = workbook.addWorksheet("برآورد", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
    sheet.columns = [{ width: 9 }, { width: 37 }, { width: 17 }, { width: 17 }, { width: 23 }, { width: 26 },
      { width: 29 }, { width: 18 }, { width: 35 }, { width: 32 }];
    sheet.mergeCells("A1:J1"); sheet.getCell("A1").value = `مِترا | برآورد ${String(snapshot.projectSnapshot.name || "پروژه")} | نسخه ${snapshot.version}`;
    sheet.mergeCells("A2:J2"); sheet.getCell("A2").value = `جمع مستقیم؛ بدون ضریب، تعدیل، مالیات و کسورات. ${estimateDraftDisclosure(snapshot.projectSnapshot)}`;
    sheet.getRow(2).height = 34;
    sheet.getCell("A2").alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    const basisFa = snapshot.basis === "official" ? "فهرست‌بهای رسمی" : snapshot.basis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد";
    sheet.mergeCells("A3:J3"); sheet.getCell("A3").value = `مبنای قیمت: ${basisFa}   |   تاریخ ثبت: ${snapshot.createdAt.toISOString().slice(0, 10)}   |   تمام مبالغ: ریال`;
    const tableHeaders = ["ردیف", "شرح عملیات", "واحد", "مقدار", "بهای واحد (ریال)", "مبلغ (ریال)", "منبع قیمت", "تاریخ قیمت", "فرمول متره", "منبع مقدار"];
    sheet.getRow(4).values = tableHeaders;
    sheet.getRow(4).height = 29;
    sheet.getRow(4).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173640" } };
      cell.font = { name: "Tahoma", bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.alignment = { horizontal: "right", vertical: "middle" }; });
    rows.forEach((row, index) => {
      const n = index + 5;
      sheet.getRow(n).values = [index + 1, row.title, row.unit, excelSafe(row.quantity), excelSafe(row.unitPriceRial),
        { formula: `ROUND(D${n}*E${n},0)`, result: excelSafe(row.amountRial) }, row.priceSource, row.priceDate, row.formula, row.sourceNote];
      sheet.getRow(n).height = 26;
      sheet.getRow(n).eachCell((cell) => { cell.font = { name: "Tahoma", size: 10, color: { argb: "FF263B40" } };
        cell.alignment = { horizontal: "right", vertical: "middle" }; if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7F6" } }; });
      sheet.getCell(`D${n}`).numFmt = "#,##0.0000";
      sheet.getCell(`E${n}`).numFmt = "#,##0.00";
      sheet.getCell(`F${n}`).numFmt = "#,##0";
    });
    const totalRow = rows.length + 5;
    sheet.getCell(`B${totalRow}`).value = "جمع مستقیم ردیف‌ها (ریال)";
    sheet.getCell(`F${totalRow}`).value = { formula: `SUM(F5:F${totalRow - 1})`, result: excelSafe(snapshot.totalRial) };
    sheet.getRow(totalRow).height = 32;
    sheet.getRow(totalRow).eachCell((cell) => { cell.font = { name: "Tahoma", bold: true, size: 11, color: { argb: "FF008E7C" } }; });
    sheet.getCell(`F${totalRow}`).numFmt = "#,##0";
    sheet.pageSetup.orientation = "landscape";
    sheet.pageSetup.fitToPage = true;
    const basis = workbook.addWorksheet("مبانی و محدودیت‌ها", { views: [{ rightToLeft: true }] });
    basis.columns = [{ width: 30 }, { width: 95 }];
    [
      ["پروژه", String(snapshot.projectSnapshot.name || "")], ["نسخه", String(snapshot.version)], ["مبنا", basisFa],
      ["تاریخ", snapshot.createdAt.toISOString()], ["جمع (ریال)", snapshot.totalRial],
      ["توضیح", "متره هندسی پایه؛ قواعد اختصاصی فهرست‌بها و شمول قراردادی توسط سامانه تأیید نشده‌اند."],
      ["هزینه‌های خارج از محاسبه", "ضرایب، تجهیز کارگاه، تعدیل، مالیات، بیمه و کسورات؛ نیازمند اسناد و موتور مستقل."],
      ["ردیف‌های پیش‌نویس", estimateDraftDisclosure(snapshot.projectSnapshot)],
      ["یادداشت نسخه", snapshot.notes || "—"],
    ].forEach((row) => basis.addRow(row));
    rows.forEach((row, index) => {
      const match = row.pricebookSnapshot;
      if (match) basis.addRow([`فهرست‌بهای ردیف ${index + 1}`, `${match.edition.title}، سال ${match.edition.baseYear}، کد ${match.item.code}، صفحه ${match.item.page || "ثبت نشده"}، شرایط: ${match.item.conditions || "ثبت نشده"}`]);
    });
    basis.eachRow((row) => row.eachCell((cell) => { cell.font = { name: "Tahoma", size: 11 }; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }));
    if (scenario) {
      const factors = workbook.addWorksheet("سناریوی ضرایب", { views: [{ rightToLeft: true }] });
      factors.columns = [{ width: 12 }, { width: 28 }, { width: 18 }, { width: 28 }, { width: 28 }, { width: 55 }];
      factors.addRow(["سناریوی دستی بر کل جمع مستقیم؛ مقادیر ثابت متنی‌اند و خودکار بازمحاسبه نمی‌شوند."]);
      factors.addRow(["ترتیب", "عنوان", "ضریب", "ورودی (ریال)", "خروجی (ریال)", "مبنای اعلام‌شده"]);
      scenario.steps.forEach((step, i) => factors.addRow([String(i + 1), step.label, step.multiplier, step.inputRial, step.outputRial, step.source]));
      factors.addRow(["", "مبلغ سناریو (ریال)", "", "", scenario.finalTotalRial]);
      factors.addRow(["گرد کردن: نیم به بالا پس از هر مرحله؛ مالیات، تعدیل، بیمه و کسورات محاسبه نشده‌اند."]);
      factors.eachRow((row) => row.eachCell((cell) => { cell.font = { name: "Tahoma", size: 10 }; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="metra-v${snapshot.version}.xlsx"` } });
  } catch (error) { return apiFailure(error); }
}
