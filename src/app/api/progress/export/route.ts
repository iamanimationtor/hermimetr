import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { estimateSnapshots, progressReports, projects } from "@/db/schema";
import { ApiError, apiFailure, requiredUser, uuid } from "@/lib/api";
import { progressTotalsSafe } from "@/lib/progress-export";

type ProgressRow = { takeoffId: string; title: string; unit: string; estimatedQuantity: string; unitPriceRial: string; previousQuantity: string; currentQuantity: string; periodQuantity: string; previousAmountRial: string; cumulativeAmountRial: string; periodAmountRial: string; evidence: string };
type ProgressTotals = { previousRial: string; cumulativeRial: string; periodRial: string; baselineRial: string };

const safeCsv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const url = new URL(request.url);
    const reportId = uuid.parse(url.searchParams.get("reportId"));
    const format = z.enum(["xlsx", "csv", "json"]).parse(url.searchParams.get("format") || "xlsx");
    const [found] = await db.select({ report: progressReports, snapshot: estimateSnapshots, project: projects }).from(progressReports)
      .innerJoin(estimateSnapshots, eq(progressReports.snapshotId, estimateSnapshots.id)).innerJoin(projects, eq(estimateSnapshots.projectId, projects.id))
      .where(and(eq(progressReports.id, reportId), eq(projects.ownerId, user.id))).limit(1);
    if (!found) throw new ApiError("گزارش یافت نشد.", 404);
    const report = found.report; const snapshot = found.snapshot; const project = found.project;
    const rows = report.rows as unknown as ProgressRow[]; const totals = report.totals as unknown as ProgressTotals;
    progressTotalsSafe(rows, totals); // validate totals can be recomputed if needed, but we keep stored
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (format === "json") return new Response(JSON.stringify({ report, snapshot, project }, null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="metra-progress-${report.sequence}.json"` } });
    if (format === "csv") {
      const lines = [
        ["دوره", report.period, `توالی ${report.sequence}`, report.voidedAt ? `باطل شده · ${report.voidReason}` : "معتبر"].map(safeCsv).join(","),
        ["شناسه گزارش", report.id].map(safeCsv).join(","),
        ["نسخه مبنا", `v${snapshot.version}`, `جمع ${snapshot.totalRial} ریال`].map(safeCsv).join(","),
        ["پروژه", String(project.name), String(project.code || "")].map(safeCsv).join(","),
        ["ردیف", "شرح", "واحد", "برآورد", "قبلی", "تجمعی", "دوره", "منبع"].map(safeCsv).join(","),
        ...rows.map((r, i) => [i + 1, r.title, r.unit, r.estimatedQuantity, r.previousQuantity, r.currentQuantity, r.periodQuantity, r.evidence].map(safeCsv).join(",")),
        ["جمع مبنا (ریال)", totals.baselineRial].map(safeCsv).join(","),
        ["تجمعی تا قبل (ریال)", totals.previousRial].map(safeCsv).join(","),
        ["تجمعی تا اکنون (ریال)", totals.cumulativeRial].map(safeCsv).join(","),
        ["مبلغ دوره (ریال)", totals.periodRial].map(safeCsv).join(","),
        ["محدودیت", "صرفاً پیشرفت مقداری؛ تعدیل، مالیات، بیمه و کسورات محاسبه نشده است."].map(safeCsv).join(","),
      ];
      return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="metra-progress-${report.sequence}.csv"` } });
    }
    const excelSafe = (value: string) => {
      const d = new Decimal(value);
      if (d.abs().gte("1000000000000000") || d.sd() > 15) throw new ApiError("عدد از محدوده اکسل فراتر است؛ از JSON یا CSV استفاده کنید.");
      return Number(value);
    };
    const workbook = new ExcelJS.Workbook(); workbook.creator = "Metra | مترا"; workbook.created = report.createdAt; workbook.calcProperties.fullCalcOnLoad = true;
    const sheet = workbook.addWorksheet("پیشرفت", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
    sheet.columns = [{ width: 9 }, { width: 34 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 38 }];
    sheet.mergeCells("A1:H1"); sheet.getCell("A1").value = `مِترا | گزارش پیشرفت | دوره ${report.period} | توالی ${report.sequence} ${report.voidedAt ? "· باطل شده" : "· معتبر"}`;
    sheet.mergeCells("A2:H2"); sheet.getCell("A2").value = `پروژه: ${String(project.name)} · نسخه مبنا: ${snapshot.version} · جمع مبنا: ${snapshot.totalRial} ریال`;
    sheet.getCell("A2").alignment = { horizontal: "right", vertical: "middle", wrapText: true }; sheet.getRow(2).height = 30;
    sheet.mergeCells("A3:H3"); sheet.getCell("A3").value = `تاریخ گزارش: ${report.createdAt.toISOString().slice(0, 10)} · شناسه: ${report.id}`;
    const headersRow = ["ردیف", "شرح عملیات", "واحد", "برآورد", "قبلی (تجمعی)", "فعلی (تجمعی)", "دوره", "منبع / اندازه‌گیری"];
    sheet.getRow(4).values = headersRow; sheet.getRow(4).height = 26;
    sheet.getRow(4).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173640" } }; cell.font = { name: "Tahoma", bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.alignment = { horizontal: "right", vertical: "middle" }; });
    rows.forEach((row, idx) => {
      const n = idx + 5;
      sheet.getRow(n).values = [idx + 1, row.title, row.unit, excelSafe(row.estimatedQuantity), excelSafe(row.previousQuantity), excelSafe(row.currentQuantity), excelSafe(row.periodQuantity), row.evidence];
      sheet.getRow(n).eachCell((cell) => { cell.font = { name: "Tahoma", size: 10, color: { argb: "FF263B40" } }; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; });
      sheet.getCell(`D${n}`).numFmt = "#,##0.0000"; sheet.getCell(`E${n}`).numFmt = "#,##0.0000"; sheet.getCell(`F${n}`).numFmt = "#,##0.0000"; sheet.getCell(`G${n}`).numFmt = "#,##0.0000";
    });
    const totalRow = rows.length + 5;
    sheet.getCell(`B${totalRow}`).value = "مبلغ دوره (ریال)"; sheet.getCell(`G${totalRow}`).value = excelSafe(totals.periodRial);
    sheet.getCell(`B${totalRow + 1}`).value = "تجمعی تا اکنون (ریال)"; sheet.getCell(`G${totalRow + 1}`).value = excelSafe(totals.cumulativeRial);
    sheet.getRow(totalRow).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FF008E7C" } }; }); sheet.getCell(`G${totalRow}`).numFmt = "#,##0";
    sheet.getCell(`G${totalRow + 1}`).numFmt = "#,##0";
    const basis = workbook.addWorksheet("مبانی", { views: [{ rightToLeft: true }] }); basis.columns = [{ width: 28 }, { width: 90 }];
    [["پروژه", String(project.name)], ["نسخه مبنا", String(snapshot.version)], ["جمع مبنا (ریال)", snapshot.totalRial], ["دوره", report.period], ["توالی", String(report.sequence)], ["وضعیت", report.voidedAt ? `باطل شده · ${report.voidReason}` : "معتبر"], ["محدودیت", "صرفاً پیشرفت مقداری؛ صورت‌وضعیت قراردادی کامل نیست."]].forEach((r) => basis.addRow(r));
    basis.eachRow((row) => row.eachCell((cell) => { cell.font = { name: "Tahoma", size: 11 }; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }));
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="metra-progress-${report.sequence}.xlsx"` } });
  } catch (error) { return apiFailure(error); }
}
