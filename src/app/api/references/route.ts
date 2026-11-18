import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sourceReferences } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, requestBody, requiredUser, shortText, uuid, validDateLabel } from "@/lib/api";

const fields = z.object({
  title: shortText(300), kind: z.enum(["pricebook", "regulation", "contract", "adjustment", "technical", "other"]),
  issuer: shortText(220), documentNumber: optionalText(120), issueDate: optionalText(30), effectiveDate: optionalText(30),
  basePeriod: optionalText(60), scope: optionalText(1500), amendments: optionalText(1500), replacement: optionalText(500),
  url: optionalText(1500), notes: optionalText(2000),
});

function prepared(data: z.infer<typeof fields>) {
  if (data.url) { try { if (new URL(data.url).protocol !== "https:") throw new Error(); } catch { throw new ApiError("نشانی سند باید با https شروع شود."); } }
  return { ...data, documentNumber: data.documentNumber || null, issueDate: data.issueDate ? validDateLabel(data.issueDate, "تاریخ ابلاغ") : null,
    effectiveDate: data.effectiveDate ? validDateLabel(data.effectiveDate, "تاریخ اجرا") : null, basePeriod: data.basePeriod || null, scope: data.scope || null,
    amendments: data.amendments || null, replacement: data.replacement || null, url: data.url || null, notes: data.notes || null };
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const data = prepared(fields.parse(await requestBody(request)));
    const [item] = await db.insert(sourceReferences).values({ ...data, ownerId: user.id, status: "unverified" }).returning();
    await audit(user.id, null, "reference", item.id, "create", null, { title: item.title, issuer: item.issuer });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const id = uuid.parse(body.id);
    const [previous] = await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, id), eq(sourceReferences.ownerId, user.id))).limit(1);
    if (!previous) throw new ApiError("سند مرجع یافت نشد.", 404);
    if (body.action === "status") {
      const status = z.enum(["verified", "unverified", "superseded"]).parse(body.status);
      if (status === "verified" && (!previous.documentNumber?.trim() || !previous.issueDate?.trim() || !previous.effectiveDate?.trim()
        || !previous.scope?.trim() || !previous.url?.trim())) {
        throw new ApiError("برای تأیید، شماره، تاریخ ابلاغ، تاریخ اجرا، دامنه شمول و لینک مرجع را تکمیل کنید.");
      }
      if (status === "verified" && previous.kind === "pricebook") {
        if (!previous.basePeriod?.trim()) throw new ApiError("سال یا دوره مبنای فهرست‌بها باید مشخص باشد.");
        const hostname = new URL(previous.url!).hostname.toLowerCase();
        if (hostname !== "mporg.ir" && !hostname.endsWith(".mporg.ir")) {
          throw new ApiError("برای فهرست‌بهای رسمی، لینک مرجع باید در دامنه سازمان برنامه‌وبودجه (mporg.ir) باشد.");
        }
      }
      const [item] = await db.update(sourceReferences).set({ status }).where(eq(sourceReferences.id, id)).returning();
      await audit(user.id, null, "reference", id, "status", { status: previous.status }, { status });
      return Response.json({ item });
    }
    if (body.action !== "update") throw new ApiError("عملیات ناشناخته است.");
    const data = prepared(fields.parse(body));
    const [item] = await db.update(sourceReferences).set({ ...data, status: "unverified" }).where(eq(sourceReferences.id, id)).returning();
    await audit(user.id, null, "reference", id, "update", { title: previous.title, status: previous.status }, { title: item.title, status: item.status });
    return Response.json({ item });
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const id = uuid.parse(body.id);
    const [item] = await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, id), eq(sourceReferences.ownerId, user.id))).limit(1);
    if (!item) throw new ApiError("سند مرجع یافت نشد.", 404);
    await db.delete(sourceReferences).where(eq(sourceReferences.id, id));
    await audit(user.id, null, "reference", id, "delete", { title: item.title }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
