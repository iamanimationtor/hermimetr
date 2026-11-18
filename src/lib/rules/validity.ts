import { evaluateRule, type RuleBankEntry, type RuleInput } from "./engine";

/**
 * Live validity of a stored takeoff row with respect to the CURRENT state of its rule.
 *
 * Purpose: when a rule definition changes, is retired, or loses its expert approval, the rows that were computed
 * with it must be visibly flagged — but never rewritten and never affecting already-stored estimate snapshots.
 * Rows are only marked; recomputation and re-confirmation are always explicit user actions.
 */

export type RowEvidence = {
  ruleRef: string | null;
  ruleHash: string | null;
  ruleKey: string | null;
  ruleVersion: number | null;
  certainty: string | null;
  status: string;
  isDemo: boolean;
  quantity: string;
  ruleInputs: unknown;
};
/**
 * ok       — the row rests on a valid, unchanged rule.
 * outdated — the row's own version is still sound, but a newer active version of the same rule exists.
 * stale    — the stored value can no longer be reproduced from the stored inputs (blocking).
 * unusable — the rule is missing, retired, or no longer approved (blocking).
 */
export type ValidityState = "ok" | "outdated" | "stale" | "unusable";
export type RowValidity = { state: ValidityState; label: string; reasons: string[]; action: string };

const finish = (state: ValidityState, reasons: string[], action: string): RowValidity => ({
  state,
  label: state === "ok" ? "معتبر" : state === "stale" ? "نیازمند بازبینی — قاعده تغییر کرده" : "غیرقابل اتکا",
  reasons,
  action,
});

/** Recomputes the row from its stored normalised inputs; a mismatch means the row no longer reproduces. */
function reproduces(entry: RuleBankEntry, row: RowEvidence): boolean {
  try {
    return evaluateRule(entry.definition, (row.ruleInputs ?? {}) as RuleInput).quantity === row.quantity;
  } catch {
    return false;
  }
}

export function assessRow(row: RowEvidence, entry: RuleBankEntry | undefined, newerVersion?: number | null): RowValidity {
  // A simple geometric row (phase 1) carries its own dimensions and formula, so it has no rule dependency.
  if (!row.ruleRef) return finish("ok", [], "");
  if (!entry) {
    return finish("unusable", [`قاعده «${row.ruleKey ?? row.ruleRef}» نسخه ${row.ruleVersion ?? "—"} دیگر در بانک قواعد موجود نیست.`],
      "ردیف را با نسخه موجود قاعده یا با ثبت ساده هندسی بازمحاسبه کنید.");
  }
  if (entry.hash !== row.ruleHash) {
    return finish("stale", [
      `تعریف قاعده پس از محاسبه این ردیف تغییر کرده است (نسخه ثبت‌شده ${row.ruleVersion ?? "—"}، نسخه فعلی ${entry.definition.version}).`,
      "مقدار ذخیره‌شده و ردیابی آن دست‌نخورده مانده است.",
    ], "ردیف را با نسخه فعلی قاعده بازمحاسبه و دوباره تأیید کنید.");
  }
  const usability = entry.usability;
  if (usability.certainty === "blocked") {
    return finish("unusable", [`قاعده این ردیف قابل استفاده نیست: ${usability.reasons.join(" ")}`],
      "نسخه قاعده را بازگردانید یا ردیف را با قاعده دیگری بازمحاسبه کنید.");
  }
  if (usability.certainty === "provisional") {
    return finish("unusable", [`قاعده این ردیف تأیید نشده است: ${usability.reasons.join(" ")}`],
      "سند مرجع را در منابع مرجع تأیید کنید و نسخه قاعده را توسط متخصص بازبینی کنید.");
  }
  if (!reproduces(entry, row)) {
    return finish("stale", ["بازمحاسبه با ورودی‌های ذخیره‌شده به مقدار ثبت‌شده نمی‌رسد."],
      "ورودی‌ها یا فرمول قاعده بررسی و ردیف بازمحاسبه شود.");
  }
  if (newerVersion && newerVersion > (row.ruleVersion ?? 0)) {
    // Informational only: the row's own version is immutable and still reproduces, so nothing is blocked.
    return {
      state: "outdated", label: `نسخه ${fa(newerVersion)} از این قاعده منتشر شده است`,
      reasons: [`این ردیف با نسخه ${row.ruleVersion ?? "—"} محاسبه شده و نسخه جدیدتری از قاعده «${row.ruleKey ?? ""}» موجود است.`],
      action: "در صورت لزوم، ردیف را با نسخه جدید بازمحاسبه کنید؛ مقدار فعلی معتبر است.",
    };
  }
  if (row.status === "confirmed" && row.certainty !== "definitive" && row.certainty !== "geometric") {
    return finish("stale", ["قطعیت ثبت‌شده این ردیف با وضعیت فعلی قاعده هم‌خوان نیست."], "ردیف را دوباره تأیید کنید.");
  }
  return finish("ok", usability.reasons, "");
}

const DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (value: number) => String(value).replace(/\d/g, (digit) => DIGITS[Number(digit)]);

/** "outdated" is informational: the row itself is still sound, so it stays in the estimate. */
export const isUsableInEstimate = (validity: RowValidity) => validity.state === "ok" || validity.state === "outdated";
export const blocksConfirmation = (validity: RowValidity) => validity.state === "stale" || validity.state === "unusable";
