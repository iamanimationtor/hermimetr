import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { priceItems, sourceReferences } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, requestBody, requiredUser, shortText, uuid, validDateLabel } from "@/lib/api";
import { decimal, normalizeDigits } from "@/lib/calculations";

const fields = z.object({
  title: shortText(300), code: optionalText(80), category: optionalText(100), unit: z.enum(["متر", "مترمربع", "مترمکعب", "عدد", "کیلوگرم"]),
  basis: z.enum(["market", "contractor", "official"]), amount: shortText(40), currency: z.enum(["IRR", "IRT"]),
  sourceName: shortText(240), sourceUrl: optionalText(1000), supplier: optionalText(200), region: optionalText(120),
  priceDate: shortText(30), validUntil: optionalText(30), referenceId: uuid.optional().nullable(), confirmed: z.boolean(),
});

async function prepared(data: z.infer<typeof fields>, ownerId: string) {
  const amount = decimal(data.amount, "بهای واحد");
  if (amount.lte(0)) throw new ApiError("بهای واحد باید بزرگ‌تر از صفر باشد.");
  if (amount.gte("100000000000000000000")) throw new ApiError("بهای واحد از محدوده قابل ذخیره‌سازی بزرگ‌تر است.");
  if (amount.decimalPlaces() > 2) throw new ApiError("بهای واحد حداکثر دو رقم اعشار می‌پذیرد.");
  if (data.sourceUrl) { try { if (new URL(data.sourceUrl).protocol !== "https:") throw new Error(); } catch { throw new ApiError("نشانی منبع باید با https شروع شود."); } }
  if (data.basis === "official") {
    if (!data.code?.trim()) throw new ApiError("شماره ردیف فهرست‌بها الزامی است.");
    if (!data.referenceId) throw new ApiError("ردیف رسمی باید به سند فهرست‌بهای تأییدشده متصل باشد.");
    const [ref] = await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, data.referenceId), eq(sourceReferences.ownerId, ownerId))).limit(1);
    let host = "";
    try { host = ref?.url ? new URL(ref.url).hostname.toLowerCase() : ""; } catch { host = ""; }
    if (!ref || ref.status !== "verified" || ref.kind !== "pricebook" || !ref.basePeriod ||
      (host !== "mporg.ir" && !host.endsWith(".mporg.ir"))) throw new ApiError("سند فهرست‌بهای بازبینی‌شده در درگاه سازمان برنامه‌وبودجه لازم است.");
  }
  return { ...data, amount: normalizeDigits(data.amount), code: data.code || null, category: data.category || null,
    sourceUrl: data.sourceUrl || null, supplier: data.supplier || null, region: data.region || null,
    priceDate: validDateLabel(data.priceDate, "تاریخ قیمت"),
    validUntil: data.validUntil ? validDateLabel(data.validUntil, "تاریخ اعتبار") : null, referenceId: data.referenceId || null };
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const data = await prepared(fields.parse(await requestBody(request)), user.id);
    const [item] = await db.insert(priceItems).values({ ...data, ownerId: user.id }).returning();
    await audit(user.id, null, "price", item.id, "create", null, { title: item.title, amount: item.amount, basis: item.basis, sourceName: item.sourceName });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const id = uuid.parse(body.id);
    const [previous] = await db.select().from(priceItems).where(and(eq(priceItems.id, id), eq(priceItems.ownerId, user.id))).limit(1);
    if (!previous) throw new ApiError("بهای واحد یافت نشد.", 404);
    const data = await prepared(fields.parse(body), user.id);
    const [item] = await db.update(priceItems).set(data).where(eq(priceItems.id, id)).returning();
    await audit(user.id, null, "price", id, "update", { amount: previous.amount, sourceName: previous.sourceName },
      { amount: item.amount, sourceName: item.sourceName });
    return Response.json({ item });
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const id = uuid.parse(body.id);
    const [item] = await db.select().from(priceItems).where(and(eq(priceItems.id, id), eq(priceItems.ownerId, user.id))).limit(1);
    if (!item) throw new ApiError("بهای واحد یافت نشد.", 404);
    // Clear the pricebook link first: the FK nulls priceId on delete, so this must run before.
    const { takeoffItems } = await import("@/db/schema");
    await db.update(takeoffItems).set({ pricebookItemId: null }).where(eq(takeoffItems.priceId, id));
    await db.delete(priceItems).where(eq(priceItems.id, id));
    await audit(user.id, null, "price", id, "delete", { title: item.title, amount: item.amount }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
