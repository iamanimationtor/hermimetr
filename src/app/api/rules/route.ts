import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { engineeringReviews, ruleVersions, sourceReferences } from "@/db/schema";
import { ApiError, apiFailure, audit, optionalText, ownedProject, requestBody, requiredUser, shortText, uuid, validDateLabel } from "@/lib/api";
import { measurementUnits } from "@/lib/calculations";
import { compileRule, evaluateRule, type RuleDefinition, type RuleInput, type RuleList, type RuleParameter } from "@/lib/rules/engine";
import { REFERENCE_CASES } from "@/lib/rules/reference-cases";
import { caseHash, hashDefinition, loadRuleBank, usabilityFor } from "@/lib/rules/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requiredUser();
    const { bank, caseReviews } = await loadRuleBank(user.id);
    return Response.json({ rules: bank, caseReviews, cases: REFERENCE_CASES });
  } catch (error) { return apiFailure(error); }
}

const reviewSchema = z.object({
  subjectType: z.enum(["rule", "reference_case"]), subjectKey: z.string().min(1).max(200),
  status: z.enum(["approved", "rejected", "revoked"]), reviewerName: shortText(160), reviewerCredential: optionalText(200),
  reviewerRole: z.enum(["estimator", "reviewer", "technical_manager", "external_expert", "other"]),
  note: optionalText(1500), attest: z.boolean().refine((value) => value === true, "تأیید مسئولیت بازبینی الزامی است."),
});

const parameterSchema = z.object({
  key: z.string().trim().min(1).max(32), label: shortText(140), unit: z.string().trim().max(40),
  kind: z.enum(["decimal", "integer"]), min: z.string().trim().max(30).optional(), max: z.string().trim().max(30).optional(),
  exclusiveMin: z.boolean().optional(), scale: z.number().int().min(0).max(4).optional(),
  default: z.string().trim().max(30).optional(), help: optionalText(400),
});
const listSchema = z.object({
  key: z.string().trim().min(1).max(32), label: shortText(140), fields: z.array(parameterSchema).min(1).max(8),
  minItems: z.number().int().min(0).max(200).optional(), maxItems: z.number().int().min(0).max(200).optional(), help: optionalText(400),
});
const stepSchema = z.object({ key: z.string().trim().min(1).max(40), label: shortText(140), expression: z.string().min(1).max(600), unit: z.string().trim().max(40).optional() });

/** A version can change anything except its own identity; nothing is copied silently from the base definition. */
const versionSchema = z.object({
  baseRef: z.string().min(5).max(160), key: z.string().trim().max(120).optional(),
  title: shortText(200), operation: shortText(100), discipline: shortText(100),
  outputKind: z.enum(Object.keys(measurementUnits) as [string, ...string[]]),
  basis: z.enum(["geometric", "regulatory"]),
  parameters: z.array(parameterSchema).max(24), lists: z.array(listSchema).max(4),
  steps: z.array(stepSchema).min(1).max(24), result: z.string().trim().min(1).max(40),
  constraints: z.array(z.object({ expression: z.string().min(1).max(600), message: shortText(300) })).max(12).optional(),
  roundingScale: z.number().int().min(0).max(4),
  measurementRule: shortText(3000), additions: optionalText(3000), deductions: optionalText(3000),
  exceptions: optionalText(3000), scope: optionalText(3000),
  referenceId: uuid.optional().nullable(), clause: optionalText(300), page: optionalText(120), quote: optionalText(2000),
  validFrom: optionalText(30), validTo: optionalText(30), changeNote: shortText(1000),
});

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const { bank } = await loadRuleBank(user.id);
    const find = (ref: unknown) => {
      const entry = bank.find((candidate) => candidate.ref === ref);
      if (!entry) throw new ApiError("قاعده یافت نشد.", 404);
      return entry;
    };

    if (body.action === "evaluate") {
      const data = z.object({ ruleRef: z.string().max(160), input: z.unknown(), projectId: uuid.optional() }).parse(body);
      const entry = find(data.ruleRef);
      const project = data.projectId ? await ownedProject(data.projectId, user.id) : null;
      const result = evaluateRule(entry.definition, (data.input ?? {}) as RuleInput);
      return Response.json({ result, ruleHash: entry.hash, usability: usabilityFor(entry, project?.estimateDate, Boolean(project)) });
    }

    if (body.action === "review") {
      const data = reviewSchema.parse(body);
      let hash: string;
      let provenance: { ruleRef?: string; ruleKey?: string; ruleVersion?: number; referenceId?: string | null; basis?: string };
      if (data.subjectType === "rule") {
        const entry = find(data.subjectKey);
        hash = entry.hash;
        provenance = { ruleRef: entry.ref, ruleKey: entry.definition.key, ruleVersion: entry.definition.version, referenceId: entry.referenceId, basis: entry.definition.basis };
        if (data.status === "approved") {
          compileRule(entry.definition);
          for (const item of REFERENCE_CASES.filter((candidate) => candidate.ruleRef === entry.ref)) {
            if (evaluateRule(entry.definition, item.input).quantity !== item.expected) throw new ApiError(`مثال مرجع ${item.id} با این قاعده تطبیق ندارد؛ تأیید ثبت نشد.`);
          }
        }
      } else {
        const item = REFERENCE_CASES.find((candidate) => candidate.id === data.subjectKey);
        if (!item) throw new ApiError("مثال مرجع یافت نشد.", 404);
        const entry = find(item.ruleRef);
        if (data.status === "approved" && evaluateRule(entry.definition, item.input).quantity !== item.expected) {
          throw new ApiError("نتیجه موتور با مقدار مرجع این مثال یکسان نیست؛ تأیید ثبت نشد.");
        }
        hash = caseHash(item, entry.hash);
        provenance = { ruleRef: entry.ref, ruleKey: entry.definition.key, ruleVersion: entry.definition.version, referenceId: entry.referenceId, basis: entry.definition.basis };
      }
      const [review] = await db.insert(engineeringReviews).values({
        ownerId: user.id, subjectType: data.subjectType, subjectKey: data.subjectKey, definitionHash: hash, status: data.status,
        reviewerName: data.reviewerName, reviewerCredential: data.reviewerCredential || null, reviewerRole: data.reviewerRole,
        note: data.note || null, ...provenance,
      }).returning();
      await audit(user.id, null, "review", review.id, data.status, null, { subjectType: data.subjectType, subjectKey: data.subjectKey, reviewerName: data.reviewerName, reviewerRole: data.reviewerRole });
      return Response.json({ review }, { status: 201 });
    }

    if (body.action === "createVersion") {
      const data = versionSchema.parse(body);
      const base = find(data.baseRef);
      const key = data.key?.trim() || base.definition.key;
      if (data.basis === "regulatory") {
        if (!data.referenceId) throw new ApiError("برای قاعده ضابطه‌ای، انتخاب سند مرجع الزامی است.");
        if (!data.clause?.trim() || !data.page?.trim()) throw new ApiError("برای قاعده ضابطه‌ای، بند و صفحه سند الزامی است.");
      }
      const [reference] = data.referenceId
        ? await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, data.referenceId), eq(sourceReferences.ownerId, user.id))).limit(1)
        : [undefined];
      if (data.referenceId && !reference) throw new ApiError("سند مرجع انتخاب‌شده در کتابخانه منابع یافت نشد.", 404);

      const definitionOf = (version: number): RuleDefinition => ({
        key, version, title: data.title, operation: data.operation, discipline: data.discipline,
        outputKind: data.outputKind as RuleDefinition["outputKind"], unit: measurementUnits[data.outputKind as keyof typeof measurementUnits],
        basis: data.basis,
        parameters: data.parameters as RuleParameter[], lists: data.lists as RuleList[],
        steps: data.steps.map((step) => ({ key: step.key, label: step.label, expression: step.expression, ...(step.unit ? { unit: step.unit } : {}) })),
        result: data.result, constraints: (data.constraints ?? []).map((item) => ({ expression: item.expression, message: item.message })),
        rounding: { scale: data.roundingScale, mode: "half_up" },
        measurementRule: data.measurementRule, additions: data.additions ?? "", deductions: data.deductions ?? "",
        exceptions: data.exceptions ?? "", scope: data.scope ?? "",
        citations: reference ? [{
          referenceId: reference.id, documentTitle: reference.title, documentNumber: reference.documentNumber, documentDate: reference.issueDate,
          clause: data.clause ?? "", page: data.page ?? "", quote: data.quote || null,
          note: reference.status === "verified" ? null : "سند مرجع هنوز تأیید نشده است.",
        }] : [],
        // A workspace version never claims a verified source; that gate is reached only through the reference library.
        validFrom: data.validFrom ? validDateLabel(data.validFrom, "تاریخ شروع اعتبار") : null,
        validTo: data.validTo ? validDateLabel(data.validTo, "تاریخ پایان اعتبار") : null,
        sourceStatus: "unverified", changeNote: data.changeNote, supersedes: base.ref,
      });
      compileRule(definitionOf(1)); // full validation of names, formulas, units, citations and rounding
      const isSameKey = key === base.definition.key;
      const systemMax = isSameKey ? Math.max(0, ...bank.filter((entry) => entry.origin === "system" && entry.definition.key === key).map((entry) => entry.definition.version)) : 0;
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${user.id}:${key}`}))`);
        const [latest] = await tx.select({ version: ruleVersions.version }).from(ruleVersions)
          .where(and(eq(ruleVersions.ownerId, user.id), eq(ruleVersions.ruleKey, key))).orderBy(desc(ruleVersions.version)).limit(1);
        const definition = definitionOf(Math.max(latest?.version ?? 0, systemMax) + 1);
        const [row] = await tx.insert(ruleVersions).values({
          ownerId: user.id, ruleKey: key, version: definition.version, baseRef: base.ref,
          definition: definition as unknown as Record<string, unknown>, definitionHash: hashDefinition(definition),
          referenceId: reference?.id ?? null, changeNote: data.changeNote,
        }).returning();
        return row;
      });
      await audit(user.id, null, "rule", created.id, "create_version", { baseRef: base.ref },
        { ruleKey: key, version: created.version, referenceId: reference?.id ?? null, basis: data.basis, newKey: !isSameKey });
      return Response.json({ version: { id: created.id, ref: `ws:${created.id}`, ruleKey: key, version: created.version } }, { status: 201 });
    }

    if (body.action === "retire") {
      const id = uuid.parse(body.id);
      const [row] = await db.update(ruleVersions).set({ status: "retired" })
        .where(and(eq(ruleVersions.id, id), eq(ruleVersions.ownerId, user.id))).returning({ id: ruleVersions.id, ruleKey: ruleVersions.ruleKey, version: ruleVersions.version });
      if (!row) throw new ApiError("نسخه فضای کار یافت نشد.", 404);
      await audit(user.id, null, "rule", row.id, "retire", null, { ruleKey: row.ruleKey, version: row.version });
      return Response.json({ ok: true });
    }
    throw new ApiError("عملیات ناشناخته است.");
  } catch (error) { return apiFailure(error); }
}
