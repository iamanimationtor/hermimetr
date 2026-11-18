import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, ownedProject, requestBody, requiredUser, shortText, uuid, validDateLabel } from "@/lib/api";
import { decimal, normalizeDigits } from "@/lib/calculations";

const fields = z.object({
  name: shortText(220), code: optionalText(60), type: shortText(80), province: optionalText(100), city: optionalText(100),
  area: optionalText(30), floors: z.number().int().min(0).max(200), basements: z.number().int().min(0).max(50),
  structure: optionalText(100), foundation: optionalText(100), employer: optionalText(160), contractor: optionalText(160),
  contractType: optionalText(100), fundingType: z.enum(["private", "public", "partnership"]),
  pricingBasis: z.enum(["market", "contractor", "official"]), contractReference: optionalText(1500),
  estimateDate: optionalText(30), stage: z.enum(["conceptual", "preliminary", "initial_drawings", "detailed", "execution_drawings", "confirmed"]),
  notes: optionalText(4000),
});

function prepare(data: z.infer<typeof fields>) {
  const area = data.area?.trim() ? decimal(data.area, "زیربنا") : null;
  if (area && area.lte(0)) throw new ApiError("زیربنا باید بزرگ‌تر از صفر باشد.");
  if (area && (area.gte("1000000000000000") || area.decimalPlaces() > 3)) throw new ApiError("زیربنا باید در محدوده مجاز و حداکثر با سه رقم اعشار باشد.");
  if (data.pricingBasis === "official" && !data.contractReference?.trim()) {
    throw new ApiError("برای انتخاب مبنای رسمی، ارجاع صریح به بند پیمان یا مبنای قراردادی ضروری است.");
  }
  return { ...data, area: area ? normalizeDigits(data.area!) : null, code: data.code || null, province: data.province || null,
    city: data.city || null, structure: data.structure || null, foundation: data.foundation || null,
    employer: data.employer || null, contractor: data.contractor || null, contractType: data.contractType || null,
    contractReference: data.contractReference || null,
    estimateDate: data.estimateDate ? validDateLabel(data.estimateDate, "تاریخ مبنای برآورد") : null, notes: data.notes || null };
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    if (body.action === "duplicate") {
      const original = await ownedProject(uuid.parse(body.id), user.id);
      const [copy] = await db.insert(projects).values({ ...original, id: undefined, ownerId: user.id, name: `${original.name} (کپی)`, code: original.code ? `${original.code}-COPY` : null,
        status: "active", createdAt: undefined, updatedAt: new Date() }).returning();
      const originalRows = await db.select().from(takeoffItems).where(eq(takeoffItems.projectId, original.id));
      if (originalRows.length) await db.insert(takeoffItems).values(originalRows.map((row) => ({ ...row, id: undefined, projectId: copy.id,
        status: "draft", priceId: null, pricebookItemId: null, documentId: null, createdAt: undefined, updatedAt: new Date() })));
      await audit(user.id, copy.id, "project", copy.id, "duplicate", { sourceProjectId: original.id }, { name: copy.name });
      return Response.json({ project: copy }, { status: 201 });
    }
    const data = prepare(fields.parse(body));
    const [project] = await db.insert(projects).values({ ...data, ownerId: user.id, isDemo: false }).returning();
    await audit(user.id, project.id, "project", project.id, "create", null, { name: project.name });
    return Response.json({ project }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const project = await ownedProject(uuid.parse(body.id), user.id);
    if (body.action === "status") {
      const status = z.enum(["active", "archived"]).parse(body.status);
      const [updated] = await db.update(projects).set({ status, updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
      await audit(user.id, project.id, "project", project.id, status, { status: project.status }, { status });
      return Response.json({ project: updated });
    }
    if (body.action !== "update") throw new ApiError("عملیات ناشناخته است.");
    const data = prepare(fields.parse(body));
    const [updated] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(and(eq(projects.id, project.id), eq(projects.ownerId, user.id))).returning();
    await audit(user.id, project.id, "project", project.id, "update", { name: project.name, pricingBasis: project.pricingBasis, stage: project.stage },
      { name: updated.name, pricingBasis: updated.pricingBasis, stage: updated.stage });
    return Response.json({ project: updated });
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const project = await ownedProject(uuid.parse(body.id), user.id);
    if (body.confirmName !== project.name) throw new ApiError("برای حذف، نام دقیق پروژه را وارد کنید.");
    await db.delete(projects).where(and(eq(projects.id, project.id), eq(projects.ownerId, user.id)));
    await audit(user.id, null, "project", project.id, "delete", { name: project.name }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
