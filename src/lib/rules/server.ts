import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { engineeringReviews, ruleVersions, sourceReferences } from "@/db/schema";
import { SYSTEM_RULES, systemRuleRef } from "./catalog";
import { ruleUsability, stableStringify, type ReviewInfo, type RuleBankEntry, type RuleDefinition } from "./engine";
import { REFERENCE_CASES, type ReferenceCase } from "./reference-cases";
import { assessRow, type RowEvidence, type RowValidity } from "./validity";

/** Server-side glue between the pure rule engine and the database (content hashes, reviews, workspace versions). */

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const hashDefinition = (definition: RuleDefinition) => sha256(stableStringify(definition));
export const caseHash = (item: ReferenceCase, ruleHash: string) => sha256(`${stableStringify(item)}|${ruleHash}`);

const SYSTEM = SYSTEM_RULES.map((definition) => ({ definition, ref: systemRuleRef(definition), hash: hashDefinition(definition) }));

export const usabilityFor = (entry: RuleBankEntry, onDate?: string | null, requireDate = false) => ruleUsability(entry.definition, {
  lifecycle: entry.lifecycle, sourceVerified: entry.sourceVerified, expertApproved: entry.review?.status === "approved",
  expertRejected: entry.review?.status === "rejected", onDate, requireDate, origin: entry.origin,
});

const toInfo = (row: typeof engineeringReviews.$inferSelect): ReviewInfo => ({
  status: row.status, reviewerName: row.reviewerName, reviewerCredential: row.reviewerCredential, note: row.note,
  createdAt: row.createdAt.toISOString(), reviewerRole: row.reviewerRole, ruleRef: row.ruleRef, ruleKey: row.ruleKey,
  ruleVersion: row.ruleVersion, referenceId: row.referenceId, basis: row.basis,
});

export type RuleBank = RuleBankEntry[];

export async function loadRuleBank(ownerId: string): Promise<{ bank: RuleBankEntry[]; caseReviews: Record<string, ReviewInfo> }> {
  const [versions, reviews, references] = await Promise.all([
    db.select().from(ruleVersions).where(eq(ruleVersions.ownerId, ownerId)).orderBy(ruleVersions.ruleKey, ruleVersions.version),
    db.select().from(engineeringReviews).where(eq(engineeringReviews.ownerId, ownerId)).orderBy(desc(engineeringReviews.createdAt)),
    db.select({ id: sourceReferences.id, status: sourceReferences.status }).from(sourceReferences).where(eq(sourceReferences.ownerId, ownerId)),
  ]);
  // A review only counts for the exact content it was given for; the newest record wins and a revocation clears it.
  const latestReview = (subjectType: string, subjectKey: string, hash: string): ReviewInfo | null => {
    const row = reviews.find((review) => review.subjectType === subjectType && review.subjectKey === subjectKey && review.definitionHash === hash);
    if (!row || row.status === "revoked") return null;
    return toInfo(row);
  };
  const entry = (base: Omit<RuleBankEntry, "review" | "usability" | "sourceVerified">): RuleBankEntry => {
    const review = latestReview("rule", base.ref, base.hash);
    const sourceVerified = base.origin === "workspace"
      ? references.some((reference) => reference.id === base.referenceId && reference.status === "verified")
      : base.definition.sourceStatus === "verified";
    const draft = { ...base, review, sourceVerified, usability: { certainty: "blocked" as const, label: "", reasons: [] } };
    return { ...draft, usability: usabilityFor(draft) };
  };
  const bank: RuleBankEntry[] = [
    ...SYSTEM.map((rule) => entry({ ref: rule.ref, origin: "system", id: null, definition: rule.definition, hash: rule.hash, lifecycle: "active", referenceId: null, baseRef: null, createdAt: null })),
    ...versions.map((row) => entry({
      ref: `ws:${row.id}`, origin: "workspace", id: row.id, definition: row.definition as unknown as RuleDefinition, hash: row.definitionHash,
      lifecycle: row.status === "retired" ? "retired" : "active", referenceId: row.referenceId, baseRef: row.baseRef, createdAt: row.createdAt.toISOString(),
    })),
  ];
  const caseReviews: Record<string, ReviewInfo> = {};
  for (const item of REFERENCE_CASES) {
    const rule = SYSTEM.find((candidate) => candidate.ref === item.ruleRef);
    const review = rule ? latestReview("reference_case", item.id, caseHash(item, rule.hash)) : null;
    if (review) caseReviews[item.id] = review;
  }
  return { bank, caseReviews };
}

/**
 * Assesses every stored takeoff row against the current state of its rule.
 * Rows are only described — never modified — so history and stored snapshots stay intact.
 */
export function assessRows(rows: (RowEvidence & { id: string })[], bank: RuleBankEntry[]): Record<string, RowValidity> {
  const byRef = new Map(bank.map((entry) => [entry.ref, entry]));
  const newest = new Map<string, number>();
  for (const entry of bank) {
    if (entry.lifecycle !== "active") continue;
    const key = entry.definition.key;
    newest.set(key, Math.max(newest.get(key) ?? 0, entry.definition.version));
  }
  const result: Record<string, RowValidity> = {};
  for (const row of rows) {
    const entry = row.ruleRef ? byRef.get(row.ruleRef) : undefined;
    result[row.id] = assessRow(row, entry, row.ruleKey ? newest.get(row.ruleKey) : undefined);
  }
  return result;
}
