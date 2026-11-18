import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { estimateSnapshots, projects } from "@/db/schema";
import { ApiError, apiFailure, requiredUser, uuid } from "@/lib/api";
import { estimateDraftDisclosure } from "@/lib/estimate-disclosure";
import { readCoefficientScenario } from "@/lib/coefficient-scenario";
import { rialToWordsFa } from "@/lib/rial-words";

type FrozenRow = {
  title: string;
  unit: string;
  quantity: string;
  unitPriceRial: string;
  amountRial: string;
  priceSource: string;
  priceDate: string;
  formula: string;
  sourceNote: string;
  referenceId: string | null;
  // Optional enriched fields stored in snapshot rows
  category?: string | null;
  // preserved by newer snapshots:
  pricebookSnapshot?: { item: { code: string; conditions: string | null; page: string | null }; edition: { title: string; baseYear: string } } | null;
};

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
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id))).limit(1);
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
    const ps: any = snapshot.projectSnapshot;
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (format === "json") return new Response(JSON.stringify({ snapshot }, null, 2),
      { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="metra-v${snapshot.version}.json"` } });
    if (format === "csv") {
      const lines = [
        ["ردیف", "شرح", "دسته", "واحد", "مقدار", "بهای واحد (ریال)", "مبلغ (ریال)", "منبع قیمت", "تاریخ قیمت", "فرمول متره", "منبع مقدار"].map(safeCsv).join(","),
        ...rows.map((row, index) => [index + 1, row.title, (row as any).category ?? "", row.unit, row.quantity, row.unitPriceRial, row.amountRial,
          row.priceSource, row.priceDate, row.formula, row.sourceNote].map(safeCsv).join(",")),
        ["", "جمع مستقیم ردیف‌ها (بدون ضریب و مالیات)", "", "", "", "", snapshot.totalRial].map(safeCsv).join(","),
        ["", `به حروف: ${rialToWordsFa(snapshot.totalRial)}`].map(safeCsv).join(","),
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
    workbook.creator = "مِترا | Metra";
    workbook.created = snapshot.createdAt;
    workbook.calcProperties.fullCalcOnLoad = true;

    const pName = String(ps.name || project.name || "پروژه");
    const basisFa = snapshot.basis === "official" ? "فهرست‌بهای رسمی" : snapshot.basis === "contractor" ? "اختصاصی پیمانکار" : "بازار آزاد";
    const contractRef = String(ps.contractReference || project.contractReference || "—");
    const stageFa: Record<string,string> = { conceptual:"مفهومی", preliminary:"مقدماتی", initial_drawings:"نقشه‌های اولیه", detailed:"تفصیلی", execution_drawings:"نقشه‌های اجرایی", confirmed:"مقادیر تأییدشده" };
    const stageName = stageFa[String(ps.stage || project.stage || "")] || String(ps.stage || "—");
    const wordsFa = rialToWordsFa(snapshot.totalRial);

    // ── Cover / Project sheet ──
    const cover = workbook.addWorksheet("مشخصات پروژه", { views: [{ rightToLeft: true }] });
    cover.columns = [{ width: 28 }, { width: 52 }];
    const coverRows: [string,string][] = [
      ["عنوان پروژه", pName],
      ["کد پروژه", String(ps.code || project.code || "—")],
      ["کارفرما", String(ps.employer || project.employer || "—")],
      ["پیمانکار", String(ps.contractor || project.contractor || "—")],
      ["نوع ساختمان", String(ps.type || project.type || "—")],
      ["استان / شهر", [ps.province || project.province, ps.city || project.city].filter(Boolean).join(" / ") || "—"],
      ["زیربنا (م²)", String(ps.area || project.area || "—")],
      ["طبقات / زیرزمین", `${ps.floors ?? project.floors ?? "—"} / ${ps.basements ?? project.basements ?? "—"}`],
      ["مرحله برآورد", stageName],
      ["مبنای قیمت", basisFa],
      ["ارجاع پیمان", contractRef],
      ["تاریخ مبنای برآورد", String(ps.estimateDate || project.estimateDate || "—")],
      ["نسخه برآورد", String(snapshot.version)],
      ["تاریخ ثبت نسخه", snapshot.createdAt.toISOString().slice(0,10)],
      ["جمع مستقیم (ریال)", snapshot.totalRial],
      ["به حروف", wordsFa],
    ];
    // Header
    cover.mergeCells("A1:B1"); cover.getCell("A1").value = `مِترا — گزارش برآورد حرفه‌ای | پروژه: ${pName}`;
    cover.getCell("A1").font = { name:"Tahoma", size:12, bold:true, color:{argb:"FFFFFFFF"}};
    cover.getCell("A1").fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF173640"}};
    cover.getCell("A1").alignment = { horizontal:"right", vertical:"middle" };
    cover.getRow(1).height = 28;
    cover.addRow([]);
    coverRows.forEach(([k,v]) => {
      const r = cover.addRow([k, v]);
      r.eachCell((c,i) => {
        c.font = { name:"Tahoma", size:10, bold: i===1, color:{argb: i===1 ? "FF173640" : "FF263B40"}};
        c.alignment = { horizontal:"right", vertical:"middle", wrapText:true };
        c.border = { top:{style:"thin", color:{argb:"FFE7EDEF"}}, bottom:{style:"thin", color:{argb:"FFE7EDEF"}}, left:{style:"thin", color:{argb:"FFE7EDEF"}}, right:{style:"thin", color:{argb:"FFE7EDEF"}}};
        if (i===1) c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFF2F7F6"}};
      });
    });
    cover.addRow([]);
    const noteRow = cover.addRow(["یادداشت نسخه", String(snapshot.notes || "—")]);
    noteRow.eachCell(c=> { c.font={name:"Tahoma", size:10}; c.alignment={horizontal:"right", vertical:"middle", wrapText:true}; });

    // ── Main estimate sheet ──
    const sheet = workbook.addWorksheet("برآورد", { views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }], properties:{ defaultRowHeight:16 } });
    sheet.columns = [
      { width: 7 },  // A ردیف
      { width: 38 }, // B شرح
      { width: 16 }, // C دسته
      { width: 11 }, // D واحد
      { width: 14 }, // E مقدار
      { width: 16 }, // F بها واحد
      { width: 18 }, // G مبلغ
      { width: 22 }, // H منبع
      { width: 13 }, // I تاریخ
      { width: 30 }, // J فرمول
      { width: 28 }, // K منبع مقدار
    ];
    const borderThin = { style:"thin" as const, color:{ argb:"FFD9E6E0" } };
    const headerFill = { type:"pattern" as const, pattern:"solid" as const, fgColor:{ argb:"FF173640" } };
    const subtotalFill = { type:"pattern" as const, pattern:"solid" as const, fgColor:{ argb:"FFEAF6F2" } };

    // Title block
    sheet.mergeCells("A1:K1"); sheet.getCell("A1").value = `مِترا | برآورد تفصیلی — ${pName} | نسخه ${snapshot.version} | ${basisFa}`;
    sheet.getCell("A1").font = { name:"Tahoma", size:11, bold:true, color:{argb:"FFFFFFFF"}};
    sheet.getCell("A1").fill = headerFill; sheet.getCell("A1").alignment = { horizontal:"right", vertical:"middle" }; sheet.getRow(1).height = 26;

    sheet.mergeCells("A2:K2"); sheet.getCell("A2").value = `جمع مستقیم بدون ضریب، تعدیل، مالیات و کسورات | ${estimateDraftDisclosure(snapshot.projectSnapshot)} | ارجاع: ${contractRef}`;
    sheet.getCell("A2").font = { name:"Tahoma", size:9, color:{argb:"FF2F5A52"}};
    sheet.getCell("A2").fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFF2F7F6"}};
    sheet.getCell("A2").alignment = { horizontal:"right", vertical:"middle", wrapText:true }; sheet.getRow(2).height = 32;

    sheet.mergeCells("A3:K3"); sheet.getCell("A3").value = `مبنای قیمت: ${basisFa}  |  تاریخ ثبت: ${snapshot.createdAt.toISOString().slice(0,10)}  |  مرحله: ${stageName}  |  مبالغ به ریال  |  گرد کردن: نیم‌به‌بالا`;
    sheet.getCell("A3").font = { name:"Tahoma", size:9, color:{argb:"FF56706F"}};
    sheet.getCell("A3").alignment = { horizontal:"right", vertical:"middle" }; sheet.getRow(3).height = 18;

    const tableHeaders = ["ردیف","شرح عملیات","دسته / فصل","واحد","مقدار","بهای واحد (ریال)","مبلغ (ریال)","منبع قیمت","تاریخ قیمت","فرمول متره","منبع مقدار"];
    sheet.getRow(4).values = tableHeaders;
    sheet.getRow(4).height = 26;
    sheet.getRow(4).eachCell((cell) => {
      cell.fill = headerFill; cell.font = { name:"Tahoma", bold:true, color:{argb:"FFFFFFFF"}, size:9 };
      cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
      cell.border = { top:borderThin, bottom:borderThin, left:borderThin, right:borderThin };
    });
    // Print titles
    sheet.pageSetup.printTitlesRow = "4:4";

    const dataStart = 5;
    rows.forEach((row, index) => {
      const n = dataStart + index;
      const cat = (row as any).category || (ps.category as string) || "—";
      sheet.getRow(n).values = [
        index + 1,
        row.title,
        cat,
        row.unit,
        excelSafe(row.quantity),
        excelSafe(row.unitPriceRial),
        { formula: `ROUND(E${n}*F${n},0)`, result: excelSafe(row.amountRial) },
        row.priceSource, row.priceDate, row.formula, row.sourceNote
      ];
      sheet.getRow(n).height = 22;
      sheet.getRow(n).eachCell((cell, col) => {
        cell.font = { name:"Tahoma", size:9, color:{argb:"FF263B40"}};
        cell.alignment = { horizontal: col<=3 ? "right" : col>=8 ? "right" : "center", vertical:"middle", wrapText:true };
        cell.border = { top:borderThin, bottom:borderThin, left:borderThin, right:borderThin };
        if (index % 2 === 0) cell.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFF8FCFB"}};
      });
      sheet.getCell(`E${n}`).numFmt = "#,##0.0000";
      sheet.getCell(`F${n}`).numFmt = "#,##0.00";
      sheet.getCell(`G${n}`).numFmt = "#,##0";
      sheet.getCell(`J${n}`).alignment = { horizontal:"left", vertical:"middle", wrapText:true } as any;
    });
    const dataEnd = dataStart + rows.length - 1;
    const afterData = dataEnd + 1;

    // Category subtotals (market-grade فصل breakdown)
    const categories = Array.from(new Set(rows.map(r=> (r as any).category || "سایر").filter(Boolean)));
    let subtotalRow = afterData;
    if (categories.length) {
      sheet.getCell(`B${subtotalRow}`).value = "جمع به تفکیک فصل / دسته";
      sheet.getCell(`B${subtotalRow}`).font = { name:"Tahoma", bold:true, size:10, color:{argb:"FF173640"}};
      sheet.getCell(`B${subtotalRow}`).fill = subtotalFill;
      sheet.mergeCells(`B${subtotalRow}:F${subtotalRow}`);
      subtotalRow++;
      categories.forEach((cat) => {
        // SUMIF by category column C
        sheet.getCell(`B${subtotalRow}`).value = cat;
        sheet.getCell(`C${subtotalRow}`).value = `جمع ${cat}`;
        sheet.getCell(`G${subtotalRow}`).value = { formula: `SUMIF(C${dataStart}:C${dataEnd},"${String(cat).replace(/"/g,'""')}",G${dataStart}:G${dataEnd})`, result: 0 } as any;
        sheet.getRow(subtotalRow).eachCell((c)=> { c.font={name:"Tahoma", size:9, bold:true, color:{argb:"FF173640"}}; c.fill=subtotalFill; c.border={top:borderThin,bottom:borderThin,left:borderThin,right:borderThin}; c.alignment={horizontal:"right", vertical:"middle"}; });
        sheet.getCell(`G${subtotalRow}`).numFmt = "#,##0";
        subtotalRow++;
      });
    }

    // Grand total
    const totalRow = subtotalRow;
    sheet.getCell(`B${totalRow}`).value = "جمع مستقیم کل (ریال)";
    sheet.getCell(`B${totalRow}`).font = { name:"Tahoma", bold:true, size:11, color:{argb:"FFFFFFFF"}};
    sheet.getCell(`B${totalRow}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF0E6B5E"}};
    sheet.getCell(`B${totalRow}`).alignment = { horizontal:"right", vertical:"middle"};
    sheet.mergeCells(`B${totalRow}:F${totalRow}`);
    sheet.getCell(`G${totalRow}`).value = { formula: `SUM(G${dataStart}:G${dataEnd})`, result: excelSafe(snapshot.totalRial) } as any;
    sheet.getCell(`G${totalRow}`).font = { name:"Tahoma", bold:true, size:12, color:{argb:"FFFFFFFF"}};
    sheet.getCell(`G${totalRow}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF0E6B5E"}};
    sheet.getCell(`G${totalRow}`).alignment = { horizontal:"center", vertical:"middle"};
    sheet.getCell(`G${totalRow}`).numFmt = "#,##0";
    sheet.getRow(totalRow).height = 30;
    // to-words
    const wordsRow = totalRow + 1;
    sheet.mergeCells(`A${wordsRow}:K${wordsRow}`); sheet.getCell(`A${wordsRow}`).value = `به حروف: ${wordsFa}`;
    sheet.getCell(`A${wordsRow}`).font = { name:"Tahoma", size:9, italic:true, color:{argb:"FF2F5A52"}};
    sheet.getCell(`A${wordsRow}`).alignment = { horizontal:"right", vertical:"middle", wrapText:true };
    sheet.getCell(`A${wordsRow}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFEFF7F4"}};
    sheet.getRow(wordsRow).height = 22;
    // Signature hint
    const signRow = wordsRow + 2;
    sheet.mergeCells(`A${signRow}:K${signRow}`); sheet.getCell(`A${signRow}`).value = "محل امضا:  تهیه‌کننده ________________   تایید فنی ________________   کارفرما ________________   تاریخ: ____ / ____ / ____";
    sheet.getCell(`A${signRow}`).font = { name:"Tahoma", size:9, color:{argb:"FF56706F"}};
    sheet.getCell(`A${signRow}`).alignment = { horizontal:"center", vertical:"middle"};

    // Borders for header/data already; ensure total row borders
    sheet.getRow(totalRow).eachCell(c=> c.border={top:borderThin,bottom:borderThin,left:{style:"medium", color:{argb:"FF0E6B5E"}},right:{style:"medium", color:{argb:"FF0E6B5E"}}});

    sheet.pageSetup.orientation = "landscape";
    sheet.pageSetup.paperSize = 9; // A4
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 0;
    sheet.pageSetup.margins = { left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.2, footer:0.2 };
    sheet.headerFooter.oddFooter = "&C صفحه &P از &N  |  مِترا — گزارش مبتنی بر داده‌های منجمد نسخه &A";

    // ── Bases sheet ──
    const basis = workbook.addWorksheet("مبانی و محدودیت‌ها", { views: [{ rightToLeft: true }] });
    basis.columns = [{ width: 28 }, { width: 95 }];
    basis.getRow(1).values = ["عنوان","مقدار / توضیح"]; basis.getRow(1).eachCell(c=> { c.font={name:"Tahoma", bold:true, color:{argb:"FFFFFFFF"}, size:10}; c.fill=headerFill; c.alignment={horizontal:"right", vertical:"middle"}; });
    const basisRows: [string,string][] = [
      ["پروژه", pName],
      ["کد پروژه", String(ps.code || project.code || "—")],
      ["کارفرما / پیمانکار", `${ps.employer || project.employer || "—"} / ${ps.contractor || project.contractor || "—"}`],
      ["نسخه", String(snapshot.version)],
      ["مبنا", basisFa],
      ["مرحله", stageName],
      ["ارجاع پیمان", contractRef],
      ["تاریخ ثبت", snapshot.createdAt.toISOString()],
      ["جمع مستقیم (ریال)", snapshot.totalRial],
      ["به حروف", wordsFa],
      ["توضیح", "متره هندسی پایه؛ قواعد اختصاصی فهرست‌بها و شمول قراردادی توسط سامانه تأیید نشده‌اند. برای استفاده قراردادی، منابع و دامنه شمول باید توسط کارشناس ذی‌صلاح بازبینی شوند."],
      ["هزینه‌های خارج از محاسبه", "ضرایب تعدیل، تجهیز کارگاه، بیمه، مالیات، کسورات و ... نیازمند اسناد و موتور مستقل‌اند."],
      ["ردیف‌های پیش‌نویس", estimateDraftDisclosure(snapshot.projectSnapshot)],
      ["یادداشت نسخه", snapshot.notes || "—"],
    ];
    basisRows.forEach(([k,v])=> {
      const r = basis.addRow([k,v]);
      r.eachCell((c,i)=> { c.font={name:"Tahoma", size:10, bold: i===1, color:{argb: i===1 ? "FF173640":"FF263B40"}}; c.alignment={horizontal:"right", vertical:"middle", wrapText:true}; c.border={top:borderThin,bottom:borderThin,left:borderThin,right:borderThin}; if(i===1) c.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FFF2F7F6"}}; });
    });
    rows.forEach((row, index) => {
      const match = row.pricebookSnapshot;
      if (match) {
        const r = basis.addRow([`فهرست‌بهای ردیف ${index + 1} — ${row.title.slice(0,40)}`, `${match.edition.title}، سال ${match.edition.baseYear}، کد ${match.item.code}، صفحه ${match.item.page || "ثبت نشده"}، شرایط: ${match.item.conditions || "ثبت نشده"}`]);
        r.eachCell(c=> { c.font={name:"Tahoma", size:9, color:{argb:"FF2F5A52"}}; c.alignment={horizontal:"right", vertical:"middle", wrapText:true}; });
      }
    });
    basis.pageSetup.orientation = "portrait"; basis.pageSetup.fitToPage = true;

    if (scenario) {
      const factors = workbook.addWorksheet("سناریوی ضرایب", { views: [{ rightToLeft: true }] });
      factors.columns = [{ width: 12 }, { width: 28 }, { width: 18 }, { width: 28 }, { width: 28 }, { width: 55 }];
      const h = factors.addRow(["سناریوی دستی بر کل جمع مستقیم — مقادیر ثابت متنی‌اند و خودکار بازمحاسبه نمی‌شوند."]);
      h.eachCell(c=> { c.font={name:"Tahoma", bold:true, size:9, color:{argb:"FF173640"}}; c.fill={type:"pattern", pattern:"solid", fgColor:{argb:"FFEAF6F2"}}; });
      factors.mergeCells(`A${h.number}:F${h.number}`);
      factors.addRow(["ترتیب","عنوان","ضریب","ورودی (ریال)","خروجی (ریال)","مبنای اعلام‌شده"]).eachCell(c=> { c.font={name:"Tahoma", bold:true, color:{argb:"FFFFFFFF"}, size:9}; c.fill=headerFill; c.alignment={horizontal:"center", vertical:"middle"}; });
      scenario.steps.forEach((step, i) => {
        const r = factors.addRow([String(i + 1), step.label, step.multiplier, step.inputRial, step.outputRial, step.source]);
        r.eachCell(c=> { c.font={name:"Tahoma", size:9}; c.alignment={horizontal:"right", vertical:"middle", wrapText:true}; c.border={top:borderThin,bottom:borderThin,left:borderThin,right:borderThin}; });
      });
      const sr = factors.addRow(["","مبلغ سناریو (ریال)","","",scenario.finalTotalRial,""]);
      sr.getCell(2).font={name:"Tahoma", bold:true, size:10, color:{argb:"FF0E6B5E"}}; sr.getCell(5).font={name:"Tahoma", bold:true, size:10, color:{argb:"FF0E6B5E"}}; sr.getCell(5).numFmt="#,##0";
      const foot = factors.addRow(["گرد کردن: نیم‌به‌بالا پس از هر مرحله؛ مالیات، تعدیل، بیمه و کسورات محاسبه نشده‌اند."]);
      foot.eachCell(c=> { c.font={name:"Tahoma", size:8, italic:true, color:{argb:"FF56706F"}}; });
      factors.mergeCells(`A${foot.number}:F${foot.number}`);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="metra-v${snapshot.version}.xlsx"` } });
  } catch (error) { return apiFailure(error); }
}
