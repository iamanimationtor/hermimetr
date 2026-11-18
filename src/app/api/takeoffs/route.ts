import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { priceItems, projectDocuments, takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, ownedProject, requestBody, requiredUser, shortText, uuid } from "@/lib/api";
import { calculateQuantity, decimal, normalizeDigits, type GeometryInput, type MeasurementKind } from "@/lib/calculations";
import { canonicalInputs, evaluateRule, type RuleInput } from "@/lib/rules/engine";
import { loadRuleBank, sha256, usabilityFor } from "@/lib/rules/server";
import { assessRow, blocksConfirmation } from "@/lib/rules/validity";

const shared = {
  projectId: uuid, title: shortText(240), floor: optionalText(80), location: optionalText(160),
  sourceNote: optionalText(1000), documentId: uuid.optional().nullable(), duplicateReason: optionalText(500),
};
// Phase-1 contract (simple geometric row). Unchanged for existing clients.
const fields = z.object({
  ...shared, category: shortText(100), kind: z.enum(["length", "area", "volume", "count", "weight"]), length: optionalText(40),
  width: optionalText(40), height: optionalText(40), count: shortText(40), unitWeight: optionalText(40), deduction: optionalText(40),
  ruleReference: optionalText(1000),
});
// Phase-2 contract: the quantity is produced by a versioned rule of the rule bank.
const ruleFields = z.object({
  ...shared, ruleRef: z.string().min(5).max(160),
  input: z.object({ values: z.record(z.string(), z.unknown()).optional(), lists: z.record(z.string(), z.unknown()).optional() }),
});

const place = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
const reasonGiven = (reason?: string | null) => (reason ?? "").trim().length >= 5;

async function checkDocument(documentId: string | null | undefined, projectId: string) {
  if (!documentId) return;
  const [document] = await db.select({ id: projectDocuments.id }).from(projectDocuments)
    .where(and(eq(projectDocuments.id, documentId), eq(projectDocuments.projectId, projectId))).limit(1);
  if (!document) throw new ApiError("سند انتخاب‌شده متعلق به این پروژه نیست.");
}

async function prepared(data: z.infer<typeof fields>) {
  const geometry: GeometryInput = { kind: data.kind as MeasurementKind, length: data.length, width: data.width, height: data.height,
    count: data.count, unitWeight: data.unitWeight, deduction: data.deduction };
  const result = calculateQuantity(geometry);
  await checkDocument(data.documentId, data.projectId);
  const num = (value?: string | null) => value?.trim() ? normalizeDigits(value) : null;
  const canonical = (value?: string | null) => value?.trim() ? decimal(value).toString() : "";
  const fingerprint = sha256(["basic", data.kind, canonical(data.length), canonical(data.width), canonical(data.height), canonical(data.count),
    canonical(data.unitWeight), canonical(data.deduction), place(data.floor), place(data.location), place(data.category)].join("|"));
  return { projectId: data.projectId, title: data.title, category: data.category, floor: data.floor || null, location: data.location || null,
    kind: data.kind, unit: result.unit, length: num(data.length), width: num(data.width), height: num(data.height),
    count: num(data.count)!, unitWeight: num(data.unitWeight), deduction: num(data.deduction) || "0", quantity: result.quantity,
    formula: result.formula, sourceNote: data.sourceNote || null, ruleReference: data.ruleReference || null,
    documentId: data.documentId || null, fingerprint };
}

async function preparedByRule(data: z.infer<typeof ruleFields>, ownerId: string, estimateDate: string | null) {
  const { bank } = await loadRuleBank(ownerId);
  const entry = bank.find((candidate) => candidate.ref === data.ruleRef);
  if (!entry) throw new ApiError("قاعده انتخاب‌شده در بانک قواعد یافت نشد.", 404);
  const usability = usabilityFor(entry, estimateDate, true);
  if (usability.certainty === "blocked") throw new ApiError(`این نسخه قاعده قابل استفاده نیست: ${usability.reasons.join(" ")}`);
  const result = evaluateRule(entry.definition, data.input as RuleInput);
  await checkDocument(data.documentId, data.projectId);
  const definition = entry.definition;
  const citation = definition.citations.map((item) => `${item.documentTitle}، ${item.clause}`).join("؛ ");
  const fingerprint = sha256(["rule", definition.key, entry.hash, canonicalInputs(result.inputs), place(data.floor), place(data.location)].join("|"));
  return {
    usability, warnings: result.warnings,
    values: {
      projectId: data.projectId, title: data.title, category: definition.operation, floor: data.floor || null, location: data.location || null,
      kind: result.outputKind, unit: result.unit, length: null, width: null, height: null, count: "1", unitWeight: null, deduction: "0",
      quantity: result.quantity, formula: result.formula, sourceNote: data.sourceNote || null,
      ruleReference: `قاعده ${definition.key} نسخه ${definition.version} (${usability.label})${citation ? ` — ${citation}` : ""}`.slice(0, 1000),
      documentId: data.documentId || null, ruleRef: entry.ref, ruleKey: definition.key, ruleVersion: definition.version, ruleHash: entry.hash,
      ruleInputs: result.inputs, ruleTrace: result.trace as unknown as Record<string, unknown>[], excelFormula: result.excelFormula,
      certainty: usability.certainty, fingerprint,
    },
  };
}

/** Serialises writes per project and refuses an identical measurement unless the user states why it is intentional. */
async function duplicateGuard(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string, fingerprint: string, reason: string | null | undefined, exceptId?: string) {
  await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`);
  const [duplicate] = await tx.select({ id: takeoffItems.id, title: takeoffItems.title }).from(takeoffItems)
    .where(and(eq(takeoffItems.projectId, projectId), eq(takeoffItems.fingerprint, fingerprint), exceptId ? ne(takeoffItems.id, exceptId) : undefined)).limit(1);
  if (duplicate && !reasonGiven(reason)) {
    throw new ApiError(`ردیف مشابهی با همین محاسبه، ورودی‌ها و محل («${duplicate.title}») قبلاً در این پروژه ثبت شده است. اگر تکرار عمدی است، دلیل آن را بنویسید.`, 409);
  }
  return duplicate ? (reason ?? "").trim() : null;
}

async function ownedRow(id: string, ownerId: string) {
  const [row] = await db.select().from(takeoffItems).where(eq(takeoffItems.id, uuid.parse(id))).limit(1);
  if (!row) throw new ApiError("ردیف متره یافت نشد.", 404);
  const project = await ownedProject(row.projectId, ownerId);
  return { row, project };
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    if (typeof body.ruleRef === "string") {
      const data = ruleFields.parse(body);
      const project = await ownedProject(data.projectId, user.id);
      const { values, usability, warnings } = await preparedByRule(data, user.id, project.estimateDate);
      const item = await db.transaction(async (tx) => {
        const duplicateNote = await duplicateGuard(tx, data.projectId, values.fingerprint, data.duplicateReason);
        const [row] = await tx.insert(takeoffItems).values({ ...values, status: "draft", isDemo: false, duplicateNote }).returning();
        return row;
      });
      await audit(user.id, data.projectId, "takeoff", item.id, "create", null,
        { title: item.title, quantity: item.quantity, rule: item.ruleRef, ruleVersion: item.ruleVersion, certainty: item.certainty, duplicateNote: item.duplicateNote });
      return Response.json({ item, usability, warnings }, { status: 201 });
    }
    const data = fields.parse(body);
    await ownedProject(data.projectId, user.id);
    const values = await prepared(data);
    const item = await db.transaction(async (tx) => {
      const duplicateNote = await duplicateGuard(tx, data.projectId, values.fingerprint, data.duplicateReason);
      const [row] = await tx.insert(takeoffItems).values({ ...values, status: "draft", isDemo: false, duplicateNote }).returning();
      return row;
    });
    await audit(user.id, data.projectId, "takeoff", item.id, "create", null, { title: item.title, quantity: item.quantity, formula: item.formula, duplicateNote: item.duplicateNote });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const { row, project } = await ownedRow(uuid.parse(body.id), user.id);

    if (body.action === "confirm" || body.action === "unconfirm") {
      let certainty = row.certainty;
      if (body.action === "confirm") {
        if (row.isDemo) throw new ApiError("ردیف آموزشی قابل تأیید نیست؛ ردیف واقعی جدید ثبت کنید.");
        if (!row.sourceNote?.trim()) throw new ApiError("پیش از تأیید، منبع اندازه‌گیری را ثبت کنید.");
        if (row.ruleRef) {
          // A rule-based quantity is only confirmed against the CURRENT state of its rule: same content, usable, and reproducible.
          const { bank } = await loadRuleBank(user.id);
          const entry = bank.find((candidate) => candidate.ref === row.ruleRef);
          if (!entry) throw new ApiError("قاعده این ردیف دیگر در بانک قواعد وجود ندارد؛ ردیف را بازمحاسبه کنید.");
          if (entry.hash !== row.ruleHash) throw new ApiError("تعریف قاعده پس از محاسبه این ردیف تغییر کرده است؛ ردیف را بازمحاسبه کنید.");
          const validity = assessRow(row, entry);
          if (blocksConfirmation(validity)) throw new ApiError(`این ردیف قابل تأیید نیست (${validity.label}): ${validity.reasons.join(" ")} ${validity.action}`);
          const usability = usabilityFor(entry, project.estimateDate, true);
          if (usability.certainty === "provisional" || usability.certainty === "blocked") {
            throw new ApiError(`این مقدار با قاعده تأییدنشده محاسبه شده و قابل تأیید قطعی نیست: ${usability.reasons.join(" ")}`);
          }
          if (evaluateRule(entry.definition, (row.ruleInputs ?? {}) as RuleInput).quantity !== row.quantity) {
            throw new ApiError("بازمحاسبه با ورودی‌های ذخیره‌شده به مقدار ثبت‌شده نرسید؛ ردیف را بازمحاسبه کنید.");
          }
          certainty = usability.certainty;
        }
      }
      const status = body.action === "confirm" ? "confirmed" : "draft";
      const [item] = await db.update(takeoffItems).set({ status, certainty, updatedAt: new Date() }).where(eq(takeoffItems.id, row.id)).returning();
      await audit(user.id, row.projectId, "takeoff", row.id, status, { status: row.status }, { status, certainty });
      return Response.json({ item });
    }

    if (body.action === "assignPrice") {
      const priceId = body.priceId ? uuid.parse(body.priceId) : null;
      if (priceId) {
        const [price] = await db.select().from(priceItems).where(and(eq(priceItems.id, priceId), eq(priceItems.ownerId, user.id))).limit(1);
        if (!price || price.unit !== row.unit || price.basis !== project.pricingBasis) throw new ApiError("واحد یا مبنای بهای انتخابی با این متره سازگار نیست.");
        if (price.pricebookItemId) throw new ApiError("بهای فهرست‌بها باید از مسیر تطبیق و تأیید ردیف به متره متصل شود.");
      }
      const [item] = await db.update(takeoffItems).set({ priceId, pricebookItemId: null, updatedAt: new Date() }).where(eq(takeoffItems.id, row.id)).returning();
      await audit(user.id, row.projectId, "takeoff", row.id, "assign_price", { priceId: row.priceId }, { priceId });
      return Response.json({ item });
    }

    if (body.action === "updateRule") {
      if (row.isDemo) throw new ApiError("ردیف آموزشی را نمی‌توان به داده واقعی تبدیل کرد؛ ردیف جدید بسازید.");
      const data = ruleFields.parse(body);
      if (data.projectId !== row.projectId) throw new ApiError("انتقال ردیف به پروژه دیگر مجاز نیست.");
      const { values, usability, warnings } = await preparedByRule(data, user.id, project.estimateDate);
      const item = await db.transaction(async (tx) => {
        const duplicateNote = await duplicateGuard(tx, row.projectId, values.fingerprint, data.duplicateReason, row.id);
        const keepPrice = values.unit === row.unit && !row.pricebookItemId;
        const [updated] = await tx.update(takeoffItems).set({ ...values, status: "draft", duplicateNote,
          priceId: keepPrice ? row.priceId : null, pricebookItemId: keepPrice ? row.pricebookItemId : null,
          updatedAt: new Date() }).where(eq(takeoffItems.id, row.id)).returning();
        return updated;
      });
      await audit(user.id, row.projectId, "takeoff", row.id, "update", { quantity: row.quantity, rule: row.ruleRef, inputs: row.ruleInputs },
        { quantity: item.quantity, rule: item.ruleRef, inputs: item.ruleInputs, status: item.status });
      return Response.json({ item, usability, warnings });
    }

    if (body.action !== "update") throw new ApiError("عملیات ناشناخته است.");
    if (row.isDemo) throw new ApiError("ردیف آموزشی را نمی‌توان به داده واقعی تبدیل کرد؛ ردیف جدید بسازید.");
    if (row.ruleRef) throw new ApiError("این ردیف با قاعده محاسبه شده است؛ آن را از «محاسبه با قاعده» ویرایش کنید.");
    const data = fields.parse(body);
    if (data.projectId !== row.projectId) throw new ApiError("انتقال ردیف به پروژه دیگر مجاز نیست.");
    const values = await prepared(data);
    const item = await db.transaction(async (tx) => {
      const duplicateNote = await duplicateGuard(tx, row.projectId, values.fingerprint, data.duplicateReason, row.id);
      const keepPrice = values.unit === row.unit && !row.pricebookItemId;
      const [updated] = await tx.update(takeoffItems).set({ ...values, status: "draft", duplicateNote,
        priceId: keepPrice ? row.priceId : null, pricebookItemId: keepPrice ? row.pricebookItemId : null,
        updatedAt: new Date() }).where(eq(takeoffItems.id, row.id)).returning();
      return updated;
    });
    await audit(user.id, row.projectId, "takeoff", row.id, "update", { quantity: row.quantity, formula: row.formula },
      { quantity: item.quantity, formula: item.formula, status: item.status });
    return Response.json({ item });
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const { row } = await ownedRow(uuid.parse(body.id), user.id);
    await db.delete(takeoffItems).where(eq(takeoffItems.id, row.id));
    await audit(user.id, row.projectId, "takeoff", row.id, "delete", { title: row.title, quantity: row.quantity, rule: row.ruleRef }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
