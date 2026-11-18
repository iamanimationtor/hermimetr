import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, ownedProject, requiredUser, uuid } from "@/lib/api";
import { assessRows, loadRuleBank } from "@/lib/rules/server";

export const dynamic = "force-dynamic";
type Row = typeof takeoffItems.$inferSelect;

const statusLabel = (row: Row, validity?: string) => row.isDemo ? "آموزشی"
  : row.status === "confirmed" && (validity === "stale" || validity === "unusable") ? "نیازمند بازبینی"
  : row.status === "confirmed" ? "تأییدشده" : "پیش‌نویس";
const certaintyLabel = (row: Row) => row.certainty === "definitive" ? "ضابطه تأییدشده" : row.certainty === "provisional" ? "آزمایشی — تأییدنشده"
  : row.certainty === "blocked" ? "مسدود" : row.ruleRef ? "هندسی پایه" : "هندسی پایه (ثبت ساده)";

/** Real Excel formula for a simple phase-1 row, rebuilt from its stored dimensions. */
function basicFormula(row: Row): string | null {
  const text = (value: string | null) => value === null ? null : new Decimal(value).toFixed();
  const count = text(row.count)!;
  let factors: (string | null)[];
  if (row.kind === "count") factors = [];
  else if (row.kind === "weight") factors = [text(row.unitWeight)];
  else factors = [text(row.length), ...(row.kind !== "length" ? [text(row.width)] : []), ...(row.kind === "volume" ? [text(row.height)] : [])];
  if (factors.some((factor) => factor === null)) return null;
  return `ROUND(${[...factors, count].join("*")}-${text(row.deduction) ?? "0"},4)`;
}

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const project = await ownedProject(uuid.parse(new URL(request.url).searchParams.get("projectId")), user.id);
    const rows = await db.select().from(takeoffItems).where(eq(takeoffItems.projectId, project.id))
      .orderBy(asc(takeoffItems.category), asc(takeoffItems.createdAt));
    if (!rows.length) throw new ApiError("هنوز ردیف متره‌ای برای این پروژه ثبت نشده است.", 404);
    const validity = assessRows(rows, (await loadRuleBank(user.id)).bank);
    const status = (row: Row) => statusLabel(row, validity[row.id]?.state);
    if (rows.some((row) => new Decimal(row.quantity).abs().gte("100000000000"))) throw new ApiError("مقداری از محدوده دقت عددی اکسل فراتر است.");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Metra | مترا";
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true; // Excel recomputes every formula on open instead of trusting cached values
    const font = { name: "Tahoma", size: 10, color: { argb: "FF263B40" } };
    const head = (sheet: ExcelJS.Worksheet, rowNumber: number) => sheet.getRow(rowNumber).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173640" } };
      cell.font = { name: "Tahoma", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    });

    const detail = workbook.addWorksheet("ریزمتره", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
    detail.columns = [{ width: 7 }, { width: 36 }, { width: 18 }, { width: 14 }, { width: 20 }, { width: 30 }, { width: 46 }, { width: 16 }, { width: 12 }, { width: 13 }, { width: 22 }, { width: 38 }];
    detail.mergeCells("A1:L1"); detail.getCell("A1").value = `مِترا | ریزمتره پروژه ${project.name}${project.isDemo ? " (آموزشی)" : ""}`;
    detail.mergeCells("A2:L2"); detail.getCell("A2").value = "گزارش زنده و غیرثابت: ردیف‌های «پیش‌نویس»، «آموزشی» و «آزمایشی» مقدار قطعی نیستند. مقادیر هندسی، ضابطه پرداخت فهرست‌بها محسوب نمی‌شوند.";
    detail.mergeCells("A3:L3"); detail.getCell("A3").value = `تاریخ تهیه: ${new Date().toISOString().slice(0, 10)}   |   تعداد ردیف: ${rows.length}   |   گرد کردن: نیم به بالا تا ۴ رقم اعشار`;
    for (const cellRef of ["A1", "A2", "A3"]) { detail.getCell(cellRef).font = { ...font, bold: cellRef === "A1", size: cellRef === "A1" ? 12 : 10 }; detail.getCell(cellRef).alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }
    detail.getRow(2).height = 30;
    detail.getRow(4).values = ["ردیف", "شرح عملیات", "دسته عملیات", "طبقه", "محل", "قاعده و نسخه", "فرمول با مقادیر", "مقدار", "واحد", "وضعیت", "قطعیت", "منبع مقدار"];
    detail.getRow(4).height = 28;
    head(detail, 4);
    rows.forEach((row, index) => {
      const n = index + 5;
      const formula = row.excelFormula || basicFormula(row);
      const quantity = Number(row.quantity);
      detail.getRow(n).values = [
        index + 1, row.title, row.category, row.floor ?? "", row.location ?? "",
        row.ruleKey ? `${row.ruleKey} — نسخه ${row.ruleVersion}` : "ثبت ساده هندسی", row.formula,
        formula ? { formula, result: quantity } : quantity, row.unit, status(row), certaintyLabel(row), row.sourceNote ?? "",
      ];
      detail.getRow(n).eachCell((cell) => {
        cell.font = font; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
        if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7F6" } };
      });
      detail.getCell(`G${n}`).alignment = { horizontal: "left", vertical: "middle", wrapText: true, readingOrder: "ltr" };
      detail.getCell(`H${n}`).numFmt = "#,##0.0000";
    });
    const last = rows.length + 4;
    detail.pageSetup.orientation = "landscape";
    detail.pageSetup.fitToPage = true;
    detail.pageSetup.fitToHeight = 0;

    const summary = workbook.addWorksheet("خلاصه متره", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }] });
    summary.columns = [{ width: 26 }, { width: 14 }, { width: 22 }, { width: 22 }, { width: 14 }];
    summary.mergeCells("A1:E1"); summary.getCell("A1").value = `خلاصه متره پروژه ${project.name}`;
    summary.mergeCells("A2:E2"); summary.getCell("A2").value = "جمع‌ها با فرمول تطبیق دقیق از برگه «ریزمتره» محاسبه می‌شوند؛ ردیف‌های آموزشی و نیازمند بازبینی در جمع‌ها منظور نمی‌شوند.";
    for (const cellRef of ["A1", "A2"]) { summary.getCell(cellRef).font = { ...font, bold: cellRef === "A1", size: cellRef === "A1" ? 12 : 10 }; summary.getCell(cellRef).alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }
    summary.getRow(4).values = ["دسته عملیات", "واحد", "جمع تأییدشده", "جمع پیش‌نویس", "تعداد ردیف"];
    head(summary, 4);
    const groups = new Map<string, { category: string; unit: string; confirmed: Decimal; draft: Decimal; count: number }>();
    for (const row of rows) {
      const key = `${row.category}\u0000${row.unit}`;
      const group = groups.get(key) ?? { category: row.category, unit: row.unit, confirmed: new Decimal(0), draft: new Decimal(0), count: 0 };
      group.count++;
      if (status(row) === "تأییدشده") group.confirmed = group.confirmed.plus(row.quantity);
      if (status(row) === "پیش‌نویس") group.draft = group.draft.plus(row.quantity);
      groups.set(key, group);
    }
    if ([...groups.values()].some((group) => group.confirmed.abs().gte("100000000000") || group.draft.abs().gte("100000000000"))) {
      throw new ApiError("جمع ریزمتره از محدوده دقت عددی اکسل فراتر است؛ گزارش چاپی را بررسی کنید.");
    }
    const range = (column: string) => `'ریزمتره'!$${column}$5:$${column}$${last}`;
    [...groups.values()].forEach((group, index) => {
      const n = index + 5;
      const match = `--EXACT(${range("C")},A${n}),--EXACT(${range("I")},B${n})`;
      const sumFor = (label: string) => `SUMPRODUCT(${match},--(${range("J") }="${label}"),${range("H")})`;
      summary.getRow(n).values = [
        group.category, group.unit,
        { formula: sumFor("تأییدشده"), result: group.confirmed.toNumber() }, { formula: sumFor("پیش‌نویس"), result: group.draft.toNumber() },
        { formula: `SUMPRODUCT(${match})`, result: group.count },
      ];
      summary.getRow(n).eachCell((cell) => { cell.font = font; cell.alignment = { horizontal: "right", vertical: "middle" }; });
      summary.getCell(`C${n}`).numFmt = "#,##0.0000";
      summary.getCell(`D${n}`).numFmt = "#,##0.0000";
    });

    const basis = workbook.addWorksheet("قواعد و مبانی", { views: [{ rightToLeft: true }] });
    basis.columns = [{ width: 34 }, { width: 10 }, { width: 70 }, { width: 12 }];
    basis.getRow(1).values = ["شناسه قاعده", "نسخه", "اثر انگشت تعریف قاعده (SHA-256)", "تعداد ردیف"];
    head(basis, 1);
    const used = new Map<string, { key: string; version: number | null; hash: string | null; count: number }>();
    for (const row of rows) {
      if (!row.ruleRef) continue;
      const entry = used.get(row.ruleRef) ?? { key: row.ruleKey ?? row.ruleRef, version: row.ruleVersion, hash: row.ruleHash, count: 0 };
      entry.count++;
      used.set(row.ruleRef, entry);
    }
    for (const entry of used.values()) basis.addRow([entry.key, entry.version, entry.hash, entry.count]);
    basis.addRow([]);
    basis.addRow(["یادداشت", "", "ردیف‌های «ثبت ساده هندسی» با حاصل‌ضرب مستقیم ابعاد محاسبه شده‌اند. هیچ ضابطه رسمی فهرست‌بها بدون سند تأییدشده و تأیید متخصص به‌عنوان مقدار قطعی اعمال نشده است."]);
    basis.eachRow((row, rowNumber) => { if (rowNumber > 1) row.eachCell((cell) => { cell.font = font; cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true }; }); });

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="metra-takeoff.xlsx"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiFailure(error); }
}
