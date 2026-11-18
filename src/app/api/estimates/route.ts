import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, estimateSnapshots, priceItems, projects, sourceReferences, takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, ownedProject, requestBody, requiredUser, uuid } from "@/lib/api";
import { calculateEstimate, type PricingBasis } from "@/lib/calculations";
import { assessRows, loadRuleBank, type RuleBank } from "@/lib/rules/server";

/** Live rule validity is attached to each row; a stale or unusable rule keeps the row out of the estimate. */
function withValidity(rows: typeof takeoffItems.$inferSelect[], bank: RuleBank) {
  const validity = assessRows(rows, bank);
  return rows.map((row) => ({ ...row, ruleValidity: validity[row.id]?.state ?? null }));
}

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const projectId = uuid.parse(new URL(request.url).searchParams.get("projectId"));
    const project = await ownedProject(projectId, user.id);
    const [rows, prices, references, bank] = await Promise.all([
      db.select().from(takeoffItems).where(eq(takeoffItems.projectId, project.id)),
      db.select().from(priceItems).where(eq(priceItems.ownerId, user.id)),
      db.select().from(sourceReferences).where(eq(sourceReferences.ownerId, user.id)),
      loadRuleBank(user.id),
    ]);
    const preview = calculateEstimate(withValidity(rows, bank.bank), prices, project.pricingBasis as PricingBasis,
      { contractReference: project.contractReference, verifiedReferenceIds: references.filter((ref) => ref.status === "verified" && ref.kind === "pricebook").map((ref) => ref.id) });
    if (project.isDemo) preview.issues.unshift("این پروژه آموزشی است؛ برای برآورد واقعی، پروژه جدید با اطلاعات مستند بسازید.");
    return Response.json(preview);
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = z.object({ projectId: uuid, notes: z.string().trim().max(1000).optional() }).parse(await requestBody(request));
    await ownedProject(body.projectId, user.id);
    const snapshot = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${body.projectId} AND owner_id = ${user.id} FOR UPDATE`);
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.ownerId, user.id))).limit(1);
      if (!project) throw new ApiError("پروژه یافت نشد.", 404);
      const [rows, prices, references, bank] = await Promise.all([
        tx.select().from(takeoffItems).where(eq(takeoffItems.projectId, project.id)),
        tx.select().from(priceItems).where(eq(priceItems.ownerId, user.id)),
        tx.select().from(sourceReferences).where(eq(sourceReferences.ownerId, user.id)),
        loadRuleBank(user.id),
      ]);
      const preview = calculateEstimate(withValidity(rows, bank.bank), prices, project.pricingBasis as PricingBasis,
        { contractReference: project.contractReference, verifiedReferenceIds: references.filter((ref) => ref.status === "verified" && ref.kind === "pricebook").map((ref) => ref.id) });
      if (project.isDemo) throw new ApiError("پروژه آموزشی قابل تبدیل به برآورد ثابت نیست؛ پروژه واقعی جدید بسازید.");
      if (preview.issues.length) throw new ApiError(`نسخه ثابت ساخته نشد: ${preview.issues.join(" | ")}`);
      if (!preview.lines.length) throw new ApiError("هیچ ردیف قابل برآوردی وجود ندارد.");
      const [latest] = await tx.select({ version: estimateSnapshots.version }).from(estimateSnapshots)
        .where(eq(estimateSnapshots.projectId, project.id)).orderBy(desc(estimateSnapshots.version)).limit(1);
      // Freeze the rule evidence (inputs and step-by-step trace) so the version can be reproduced later.
      const ruleSnapshotOf = (takeoffId: string) => {
        const source = rows.find((row) => row.id === takeoffId);
        return source?.ruleRef ? { ref: source.ruleRef, key: source.ruleKey, version: source.ruleVersion, hash: source.ruleHash,
          certainty: source.certainty, inputs: source.ruleInputs, trace: source.ruleTrace } : null;
      };
      const frozenRows: Record<string, unknown>[] = preview.lines.map((line) => ({ ...line, ruleSnapshot: ruleSnapshotOf(line.takeoffId),
        referenceSnapshot: line.referenceId ? references.find((ref) => ref.id === line.referenceId) ?? null : null }));
      const [saved] = await tx.insert(estimateSnapshots).values({ projectId: project.id, version: (latest?.version ?? 0) + 1,
        basis: project.pricingBasis, totalRial: preview.totalRial, rows: frozenRows,
        projectSnapshot: { ...project, includedDraftRows: preview.draftCount, methodology: "direct_confirmed_rows_only",
          excludedCosts: "No coefficients, taxes, adjustment or deductions applied" }, notes: body.notes || null }).returning();
      await tx.insert(auditLogs).values({ ownerId: user.id, projectId: project.id, entityType: "estimate", entityId: saved.id,
        action: "snapshot", before: null, after: { version: saved.version, totalRial: saved.totalRial, basis: saved.basis } });
      return saved;
    });
    return Response.json({ snapshot }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}
