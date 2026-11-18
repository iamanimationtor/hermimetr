import ExcelJS from "exceljs";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { priceItems, pricebookEditions, pricebookItems, sourceReferences, takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, ownedProject, requestBody, requiredUser, shortText, uuid } from "@/lib/api";
import { parseCsv, validatePricebookTable } from "@/lib/pricebook/import";
import { normalizeUnit, suggestMatches } from "@/lib/pricebook/match";
import { pricebookLinkIssue } from "@/lib/pricebook/integrity";
import { MAX_PRICEBOOK_FILE_BYTES } from "@/lib/limits";

export const dynamic = "force-dynamic";
type Edition = typeof pricebookEditions.$inferSelect;

async function ownedEdition(id: unknown, ownerId: string) {
  const [edition] = await db.select().from(pricebookEditions)
    .where(and(eq(pricebookEditions.id, uuid.parse(id)), eq(pricebookEditions.ownerId, ownerId))).limit(1);
  if (!edition) throw new ApiError("نسخه فهرست‌بها یافت نشد.", 404);
  return edition;
}

/** An edition may only price real estimates when it is tied to a verified pricebook document on the official domain. */
async function officialReference(edition: Edition, ownerId: string, client: Pick<typeof db, "select"> = db) {
  if (!edition.referenceId) throw new ApiError("سند مرجع فهرست‌بها به این نسخه متصل نشده است.");
  const [reference] = await client.select().from(sourceReferences)
    .where(and(eq(sourceReferences.id, edition.referenceId), eq(sourceReferences.ownerId, ownerId))).limit(1);
  if (!reference || reference.kind !== "pricebook") throw new ApiError("سند متصل به این نسخه از نوع «فهرست‌بها» نیست.");
  if (reference.status !== "verified") throw new ApiError("سند مرجع این نسخه هنوز «تأییدنشده» است؛ ابتدا آن را در منابع مرجع بازبینی و تأیید کنید.");
  let host = "";
  try { host = new URL(reference.url ?? "").hostname.toLowerCase(); } catch { host = ""; }
  if (host !== "mporg.ir" && !host.endsWith(".mporg.ir")) throw new ApiError("لینک سند مرجع باید در دامنه سازمان برنامه‌وبودجه (mporg.ir) باشد.");
  if (!reference.basePeriod?.trim() || !reference.effectiveDate?.trim()) throw new ApiError("سال مبنا و تاریخ اجرای سند مرجع باید ثبت شده باشد.");
  return reference;
}

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const url = new URL(request.url);
    const suggestFor = url.searchParams.get("suggestFor");

    if (suggestFor) {
      const [row] = await db.select().from(takeoffItems).where(eq(takeoffItems.id, uuid.parse(suggestFor))).limit(1);
      if (!row) throw new ApiError("ردیف متره یافت نشد.", 404);
      const project = await ownedProject(row.projectId, user.id);
      const editions = await db.select().from(pricebookEditions)
        .where(and(eq(pricebookEditions.ownerId, user.id), eq(pricebookEditions.status, "active")));
      const items = editions.length ? await db.select({
        id: pricebookItems.id, editionId: pricebookItems.editionId, code: pricebookItems.code, chapterCode: pricebookItems.chapterCode,
        chapterTitle: pricebookItems.chapterTitle, description: pricebookItems.description, unit: pricebookItems.unit,
        unitPriceRial: pricebookItems.unitPriceRial, conditions: pricebookItems.conditions,
      }).from(pricebookItems).where(inArray(pricebookItems.editionId, editions.map((edition) => edition.id))) : [];
      const blockers: string[] = [];
      if (!editions.length) blockers.push("هیچ نسخه فعال فهرست‌بها در فضای کار وجود ندارد؛ پیشنهادی قابل ارائه نیست.");
      if (project.isDemo) blockers.push("پروژه آموزشی است و تطبیق رسمی برای آن ثبت نمی‌شود.");
      if (project.pricingBasis !== "official") blockers.push("مبنای قیمت این پروژه «فهرست‌بهای رسمی» نیست؛ پیشنهادها فقط برای بررسی نمایش داده می‌شوند.");
      else if (!project.contractReference?.trim()) blockers.push("ارجاع به مبنای پیمان در مشخصات پروژه ثبت نشده است.");
      const suggestions = suggestMatches({ title: row.title, category: row.category, unit: row.unit }, items).map((suggestion) => {
        const edition = editions.find((candidate) => candidate.id === (suggestion.item as typeof items[number]).editionId);
        return { ...suggestion, editionTitle: edition?.title ?? "", baseYear: edition?.baseYear ?? "" };
      });
      return Response.json({ suggestions, blockers, searched: items.length, takeoff: { id: row.id, title: row.title, category: row.category, unit: row.unit, pricebookItemId: row.pricebookItemId } });
    }

    const edition = await ownedEdition(url.searchParams.get("editionId"), user.id);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const chapter = (url.searchParams.get("chapter") ?? "").slice(0, 200);
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const where = and(eq(pricebookItems.editionId, edition.id),
      query ? or(ilike(pricebookItems.code, pattern), ilike(pricebookItems.description, pattern)) : undefined,
      chapter ? eq(pricebookItems.chapterTitle, chapter) : undefined);
    const [items, totals, chapters] = await Promise.all([
      db.select().from(pricebookItems).where(where).orderBy(asc(pricebookItems.code)).limit(100).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(pricebookItems).where(where),
      db.selectDistinct({ title: pricebookItems.chapterTitle }).from(pricebookItems).where(eq(pricebookItems.editionId, edition.id)),
    ]);
    return Response.json({ items, total: totals[0]?.total ?? 0, chapters: chapters.map((entry) => entry.title).filter(Boolean).sort() });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;

    if (body.action === "createEdition") {
      const data = z.object({ title: shortText(300), discipline: shortText(100), baseYear: shortText(20), referenceId: uuid.optional().nullable(), notes: optionalText(2000) }).parse(body);
      if (data.referenceId) {
        const [reference] = await db.select({ kind: sourceReferences.kind }).from(sourceReferences)
          .where(and(eq(sourceReferences.id, data.referenceId), eq(sourceReferences.ownerId, user.id))).limit(1);
        if (!reference || reference.kind !== "pricebook") throw new ApiError("سند انتخاب‌شده باید از نوع «فهرست‌بها» و متعلق به همین فضای کار باشد.");
      }
      const [edition] = await db.insert(pricebookEditions).values({ ownerId: user.id, title: data.title, discipline: data.discipline,
        baseYear: data.baseYear, referenceId: data.referenceId || null, notes: data.notes || null, status: "draft" }).returning();
      await audit(user.id, null, "pricebook", edition.id, "create", null, { title: edition.title, baseYear: edition.baseYear });
      return Response.json({ edition }, { status: 201 });
    }

    if (body.action === "linkReference") {
      const data = z.object({ editionId: uuid, referenceId: uuid }).parse(body);
      const edition = await ownedEdition(data.editionId, user.id);
      if (edition.status !== "draft") throw new ApiError("سند مرجع فقط در وضعیت پیش‌نویس قابل تغییر است.");
      const [reference] = await db.select({ kind: sourceReferences.kind }).from(sourceReferences)
        .where(and(eq(sourceReferences.id, data.referenceId), eq(sourceReferences.ownerId, user.id))).limit(1);
      if (!reference || reference.kind !== "pricebook") throw new ApiError("سند انتخاب‌شده باید از نوع «فهرست‌بها» باشد.");
      const [updated] = await db.update(pricebookEditions).set({ referenceId: data.referenceId }).where(and(eq(pricebookEditions.id, edition.id), eq(pricebookEditions.ownerId, user.id), eq(pricebookEditions.status, "draft"))).returning();
      if (!updated) throw new ApiError("وضعیت نسخه تغییر کرده است؛ سند فقط در پیش‌نویس قابل تغییر است.");
      await audit(user.id, null, "pricebook", edition.id, "link_reference", { referenceId: edition.referenceId }, { referenceId: data.referenceId });
      return Response.json({ ok: true });
    }

    if (body.action === "import") {
      const data = z.object({ editionId: uuid, format: z.enum(["csv", "xlsx"]), content: z.string().min(1).max(6_000_000), preview: z.boolean().optional().default(false) }).parse(body);
      const edition = await ownedEdition(data.editionId, user.id);
      if (edition.status !== "draft") throw new ApiError("ردیف‌ها فقط در نسخه پیش‌نویس وارد می‌شوند؛ نسخه فعال یا بایگانی‌شده تغییر نمی‌کند.");
      let table: unknown[][];
      if (data.format === "csv") {
        if (Buffer.byteLength(data.content, "utf8") > MAX_PRICEBOOK_FILE_BYTES) throw new ApiError("حجم داده فهرست‌بها نباید از ۲٫۸ مگابایت بیشتر باشد.", 413);
        try { table = parseCsv(data.content); } catch (error) { throw new ApiError(error instanceof Error ? error.message : "فایل CSV خوانده نشد."); }
      } else {
        const workbook = new ExcelJS.Workbook();
        try {
          const bytes = Buffer.from(data.content, "base64");
          if (bytes.length > MAX_PRICEBOOK_FILE_BYTES) throw new ApiError("حجم فایل نباید از ۲٫۸ مگابایت بیشتر باشد.", 413);
          await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError("فایل Excel خوانده نشد؛ فقط قالب xlsx پذیرفته می‌شود.");
        }
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new ApiError("فایل Excel برگه‌ای ندارد.");
        if (sheet.rowCount > 20100) throw new ApiError("تعداد سطرهای فایل بیش از حد مجاز است.");
        table = [];
        if (sheet.columnCount > 30) throw new ApiError("فایل Excel بیش از ۳۰ ستون دارد؛ ستون‌های اضافی را حذف کنید.");
        const width = sheet.columnCount;
        sheet.eachRow({ includeEmpty: true }, (row) => {
          const cells: string[] = [];
          for (let column = 1; column <= width; column++) {
            const cell = row.getCell(column);
            if (cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) throw new ApiError(`سلول ${cell.address} فرمول دارد؛ ابتدا مقدار تأییدشده را به‌صورت مقدار ثابت ذخیره کنید.`);
            cells.push(String(cell.text ?? ""));
          }
          (table as string[][]).push(cells);
        });
      }
      const result = validatePricebookTable(table);
      if (result.errors.length) return Response.json({ error: "فایل پذیرفته نشد و هیچ ردیفی وارد نشد.", errors: result.errors }, { status: 400 });
      if (data.preview) return Response.json({ count: result.rows.length, skippedEmpty: result.skippedEmpty, sample: result.rows.slice(0, 10) });
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM pricebook_editions WHERE id = ${edition.id} AND owner_id = ${user.id} FOR UPDATE`);
        const [locked] = await tx.select().from(pricebookEditions).where(and(eq(pricebookEditions.id, edition.id), eq(pricebookEditions.ownerId, user.id))).limit(1);
        if (!locked || locked.status !== "draft") throw new ApiError("ردیف‌ها فقط در نسخه پیش‌نویس وارد می‌شوند؛ وضعیت نسخه تغییر کرده است.");
        const existing = await tx.select({ code: pricebookItems.code }).from(pricebookItems).where(eq(pricebookItems.editionId, edition.id));
        const taken = new Set(existing.map((entry) => entry.code));
        const clash = result.rows.filter((row) => taken.has(row.code)).slice(0, 10).map((row) => row.code);
        if (clash.length) throw new ApiError(`این کدها پیش‌تر در همین نسخه وارد شده‌اند: ${clash.join("، ")}. هیچ ردیفی وارد نشد.`);
        for (let start = 0; start < result.rows.length; start += 500) {
          await tx.insert(pricebookItems).values(result.rows.slice(start, start + 500).map((row) => ({ ...row, editionId: edition.id })));
        }
      });
      await audit(user.id, null, "pricebook", edition.id, "import", null, { rows: result.rows.length, format: data.format });
      return Response.json({ imported: result.rows.length, skippedEmpty: result.skippedEmpty }, { status: 201 });
    }

    if (body.action === "setStatus") {
      const data = z.object({ editionId: uuid, status: z.enum(["active", "archived"]) }).parse(body);
      const previous = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM pricebook_editions WHERE id = ${data.editionId} AND owner_id = ${user.id} FOR UPDATE`);
        const [edition] = await tx.select().from(pricebookEditions).where(and(eq(pricebookEditions.id, data.editionId), eq(pricebookEditions.ownerId, user.id))).limit(1);
        if (!edition) throw new ApiError("نسخه فهرست‌بها یافت نشد.", 404);
        if (data.status === "active") {
          await officialReference(edition, user.id, tx);
          const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(pricebookItems).where(eq(pricebookItems.editionId, edition.id));
          if (!count?.total) throw new ApiError("نسخه بدون ردیف قابل فعال‌سازی نیست.");
        }
        await tx.update(pricebookEditions).set({ status: data.status }).where(eq(pricebookEditions.id, edition.id));
        return edition;
      });
      await audit(user.id, null, "pricebook", previous.id, "status", { status: previous.status }, { status: data.status });
      return Response.json({ ok: true });
    }

    if (body.action === "confirmMatch") {
      const data = z.object({ takeoffId: uuid, itemId: uuid, attest: z.boolean().refine((value) => value === true, "تأیید بازبینی شرح و شرایط ردیف الزامی است.") }).parse(body);
      const [row] = await db.select().from(takeoffItems).where(eq(takeoffItems.id, data.takeoffId)).limit(1);
      if (!row) throw new ApiError("ردیف متره یافت نشد.", 404);
      const project = await ownedProject(row.projectId, user.id);
      if (project.isDemo || row.isDemo) throw new ApiError("برای داده آموزشی تطبیق رسمی ثبت نمی‌شود.");
      if (project.pricingBasis !== "official" || !project.contractReference?.trim()) {
        throw new ApiError("تطبیق رسمی فقط برای پروژه‌ای ثبت می‌شود که مبنای قیمت آن «فهرست‌بهای رسمی» و ارجاع پیمان آن ثبت شده باشد.");
      }
      const [found] = await db.select({ item: pricebookItems, edition: pricebookEditions }).from(pricebookItems)
        .innerJoin(pricebookEditions, eq(pricebookItems.editionId, pricebookEditions.id))
        .where(and(eq(pricebookItems.id, data.itemId), eq(pricebookEditions.ownerId, user.id))).limit(1);
      if (!found) throw new ApiError("ردیف فهرست‌بها یافت نشد.", 404);
      if (found.edition.status !== "active") throw new ApiError("این ردیف متعلق به نسخه‌ای است که فعال نیست.");
      const reference = await officialReference(found.edition, user.id);
      if (normalizeUnit(found.item.unit) !== normalizeUnit(row.unit)) throw new ApiError("واحد ردیف فهرست‌بها با واحد متره یکسان نیست؛ تبدیل واحد انجام نمی‌شود.");
      if (!found.item.unitPriceRial || Number(found.item.unitPriceRial) <= 0) throw new ApiError("این ردیف در فهرست واردشده بهای واحد ندارد.");
      let [price] = await db.select().from(priceItems)
        .where(and(eq(priceItems.ownerId, user.id), eq(priceItems.pricebookItemId, found.item.id))).limit(1);
      if (!price) {
        [price] = await db.insert(priceItems).values({
          ownerId: user.id, title: found.item.description.slice(0, 300), code: found.item.code, category: found.item.chapterTitle?.slice(0, 100) ?? null,
          unit: row.unit, basis: "official", amount: found.item.unitPriceRial, currency: "IRR",
          sourceName: `${found.edition.title} — ردیف ${found.item.code}`.slice(0, 240), sourceUrl: reference.url, priceDate: reference.effectiveDate!,
          referenceId: reference.id, confirmed: true, pricebookItemId: found.item.id,
        }).returning();
      }
      const issue = pricebookLinkIssue({ unit: row.unit, pricebookItemId: found.item.id }, price, found);
      if (issue) throw new ApiError(`${issue} در صورت تغییر بهای قبلی، آن را از بانک قیمت حذف و مجدداً تطبیق دهید.`);
      const [item] = await db.update(takeoffItems).set({ priceId: price.id, pricebookItemId: found.item.id, updatedAt: new Date() })
        .where(eq(takeoffItems.id, row.id)).returning();
      await audit(user.id, row.projectId, "takeoff", row.id, "match_confirm", { priceId: row.priceId },
        { priceId: price.id, pricebookItemId: found.item.id, code: found.item.code, edition: found.edition.title });
      return Response.json({ item, price });
    }
    throw new ApiError("عملیات ناشناخته است.");
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const edition = await ownedEdition(body.editionId, user.id);
    if (edition.status === "active") throw new ApiError("نسخه فعال حذف نمی‌شود؛ ابتدا آن را بایگانی کنید.");
    const [linked] = await db.select({ id: priceItems.id }).from(priceItems)
      .innerJoin(pricebookItems, eq(priceItems.pricebookItemId, pricebookItems.id))
      .where(and(eq(pricebookItems.editionId, edition.id), eq(priceItems.ownerId, user.id))).limit(1);
    if (linked) throw new ApiError("ردیف‌هایی از این نسخه در بانک قیمت استفاده شده‌اند؛ برای حفظ سابقه، نسخه بایگانی‌شده نگه داشته می‌شود.");
    await db.delete(pricebookEditions).where(eq(pricebookEditions.id, edition.id));
    await audit(user.id, null, "pricebook", edition.id, "delete", { title: edition.title }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
