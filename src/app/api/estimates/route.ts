import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, estimateSnapshots, pricebookEditions, pricebookItems, priceItems, projects, sourceReferences, takeoffItems } from "@/db/schema";
import { ApiError, apiFailure, ownedProject, requestBody, requiredUser, uuid } from "@/lib/api";
import { calculateEstimate, type PricingBasis } from "@/lib/calculations";
import { assessRows, loadRuleBank, type RuleBank } from "@/lib/rules/server";
import { pricebookLinkIssue } from "@/lib/pricebook/integrity";
import { calculateCoefficientScenario, coefficientInputSchema } from "@/lib/coefficient-scenario";

/** Bind a reviewed scenario to all inputs used to calculate the direct total. */
function reviewHash(project: typeof projects.$inferSelect, rows: typeof takeoffItems.$inferSelect[], prices: typeof priceItems.$inferSelect[],
  references: typeof sourceReferences.$inferSelect[], bank: RuleBank, evidence: Awaited<ReturnType<typeof pricebookEvidence>>) {
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  const rules = bank.map((entry) => ({ ref: entry.ref, hash: entry.hash, usability: entry.usability })).sort((a, b) => a.ref.localeCompare(b.ref));
  const links = [...evidence].sort((a, b) => a.item.id.localeCompare(b.item.id));
  return createHash("sha256").update(JSON.stringify({ project, rows: sorted(rows), prices: sorted(prices), references: sorted(references), rules, links })).digest("hex");
}

async function pricebookEvidence(ownerId: string, rows: typeof takeoffItems.$inferSelect[], prices: typeof priceItems.$inferSelect[], client: Pick<typeof db, "select"> = db) {
  const ids = [...new Set([...rows.map((row) => row.pricebookItemId), ...prices.map((price) => price.pricebookItemId)].filter((id): id is string => !!id))];
  if (!ids.length) return [];
  return client.select({ item: pricebookItems, edition: pricebookEditions }).from(pricebookItems)
    .innerJoin(pricebookEditions, eq(pricebookItems.editionId, pricebookEditions.id))
    .where(and(eq(pricebookEditions.ownerId, ownerId), inArray(pricebookItems.id, ids)));
}

function linkIssues(rows: typeof takeoffItems.$inferSelect[], prices: typeof priceItems.$inferSelect[], evidence: Awaited<ReturnType<typeof pricebookEvidence>>) {
  const priceMap = new Map(prices.map((price) => [price.id, price]));
  const itemMap = new Map(evidence.map((entry) => [entry.item.id, entry]));
  const result = new Map<string, string>();
  for (const row of rows.filter((item) => item.status === "confirmed")) {
    const price = row.priceId ? priceMap.get(row.priceId) : undefined;
    const issue = pricebookLinkIssue(row, price, row.pricebookItemId ? itemMap.get(row.pricebookItemId) : undefined);
    if (issue) result.set(row.id, `«${row.title}»: ${issue}`);
  }
  return result;
}

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
    const evidence = await pricebookEvidence(user.id, rows, prices);
    const links = linkIssues(rows, prices, evidence);
    const preview = calculateEstimate(withValidity(rows.filter((row) => !links.has(row.id)), bank.bank), prices, project.pricingBasis as PricingBasis,
      { contractReference: project.contractReference, verifiedReferenceIds: references.filter((ref) => ref.status === "verified" && ref.kind === "pricebook").map((ref) => ref.id) });
    preview.issues.push(...links.values());
    if (project.isDemo) preview.issues.unshift("این پروژه آموزشی است؛ برای برآورد واقعی، پروژه جدید با اطلاعات مستند بسازید.");
    return Response.json({ ...preview, reviewHash: reviewHash(project, rows, prices, references, bank.bank, evidence) });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = z.object({ projectId: uuid, notes: z.string().trim().max(1000).optional(), coefficientScenario: coefficientInputSchema.optional() }).parse(await requestBody(request));
    await ownedProject(body.projectId, user.id);
    const createSnapshot = () => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${body.projectId} AND owner_id = ${user.id} FOR UPDATE`);
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.ownerId, user.id))).limit(1);
      if (!project) throw new ApiError("پروژه یافت نشد.", 404);
      const rows = await tx.select().from(takeoffItems).where(eq(takeoffItems.projectId, project.id));
      const prices = await tx.select().from(priceItems).where(eq(priceItems.ownerId, user.id));
      const references = await tx.select().from(sourceReferences).where(eq(sourceReferences.ownerId, user.id));
      const bank = await loadRuleBank(user.id, tx);
      const evidence = await pricebookEvidence(user.id, rows, prices, tx);
      const links = linkIssues(rows, prices, evidence);
      const preview = calculateEstimate(withValidity(rows.filter((row) => !links.has(row.id)), bank.bank), prices, project.pricingBasis as PricingBasis,
        { contractReference: project.contractReference, verifiedReferenceIds: references.filter((ref) => ref.status === "verified" && ref.kind === "pricebook").map((ref) => ref.id) });
      preview.issues.push(...links.values());
      if (project.isDemo) throw new ApiError("پروژه آموزشی قابل تبدیل به برآورد ثابت نیست؛ پروژه واقعی جدید بسازید.");
      if (preview.issues.length) throw new ApiError(`نسخه ثابت ساخته نشد: ${preview.issues.join(" | ")}`);
      if (!preview.lines.length) throw new ApiError("هیچ ردیف قابل برآوردی وجود ندارد.");
      let coefficientScenario = null;
      if (body.coefficientScenario) {
        if (reviewHash(project, rows, prices, references, bank.bank, evidence) !== body.coefficientScenario.expectedReviewHash) {
          throw new ApiError("داده‌های برآورد پس از بازبینی تغییر کرده‌اند؛ پیش‌نمایش را تازه و ضرایب را دوباره بررسی کنید.", 409);
        }
        try { coefficientScenario = calculateCoefficientScenario(preview.totalRial, body.coefficientScenario.factors); }
        catch (error) { throw new ApiError(error instanceof Error ? error.message : "ضرایب معتبر نیستند."); }
      }
      const [latest] = await tx.select({ version: estimateSnapshots.version }).from(estimateSnapshots)
        .where(eq(estimateSnapshots.projectId, project.id)).orderBy(desc(estimateSnapshots.version)).limit(1);
      // Freeze the rule evidence (inputs and step-by-step trace) so the version can be reproduced later.
      const ruleSnapshotOf = (takeoffId: string) => {
        const source = rows.find((row) => row.id === takeoffId);
        return source?.ruleRef ? { ref: source.ruleRef, key: source.ruleKey, version: source.ruleVersion, hash: source.ruleHash,
          certainty: source.certainty, inputs: source.ruleInputs, trace: source.ruleTrace } : null;
      };
      const frozenRows: Record<string, unknown>[] = preview.lines.map((line) => {
        const row = rows.find((item) => item.id === line.takeoffId);
        const match = row?.pricebookItemId ? evidence.find((entry) => entry.item.id === row.pricebookItemId) : undefined;
        return { ...line, ruleSnapshot: ruleSnapshotOf(line.takeoffId),
          referenceSnapshot: line.referenceId ? references.find((ref) => ref.id === line.referenceId) ?? null : null,
          pricebookSnapshot: match ? { item: match.item, edition: { id: match.edition.id, title: match.edition.title,
            discipline: match.edition.discipline, baseYear: match.edition.baseYear, referenceId: match.edition.referenceId } } : null };
      });
      const [saved] = await tx.insert(estimateSnapshots).values({ projectId: project.id, version: (latest?.version ?? 0) + 1,
        basis: project.pricingBasis, totalRial: preview.totalRial, rows: frozenRows,
        projectSnapshot: { ...project, includedDraftRows: preview.draftCount, methodology: "direct_confirmed_rows_only",
          excludedCosts: "No coefficients, taxes, adjustment or deductions applied to the direct total",
          ...(coefficientScenario && body.coefficientScenario ? { coefficientScenario, coefficientReview: { actorId: user.id,
            confirmedAt: new Date().toISOString(), scopeAttested: true, reviewHash: body.coefficientScenario.expectedReviewHash } } : {}) }, notes: body.notes || null }).returning();
      await tx.insert(auditLogs).values({ ownerId: user.id, projectId: project.id, entityType: "estimate", entityId: saved.id,
        action: "snapshot", before: null, after: { version: saved.version, totalRial: saved.totalRial, basis: saved.basis,
          ...(coefficientScenario ? { manualScenario: true, finalScenarioRial: coefficientScenario.finalTotalRial, scopeAttested: true } : {}) } });
      return saved;
    }, { isolationLevel: "serializable" });
    // Competing snapshots can conflict at serializable isolation; retry only known
    // transaction conflicts (never validation errors or arbitrary unique violations).
    let snapshot: Awaited<ReturnType<typeof createSnapshot>> | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { snapshot = await createSnapshot(); break; }
      catch (error) {
        let current: unknown = error;
        let retryable = false;
        for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
          const cause = current as { code?: string; constraint?: string; cause?: unknown };
          if (cause.code === "40001" || cause.code === "40P01" || (cause.code === "23505" && cause.constraint === "estimates_project_version_unique")) retryable = true;
          current = cause.cause;
        }
        if (!retryable || attempt === 7) throw error;
      }
    }
    if (!snapshot) throw new Error("Snapshot transaction did not complete");
    return Response.json({ snapshot }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}
