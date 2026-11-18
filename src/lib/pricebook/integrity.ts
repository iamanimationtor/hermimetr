import Decimal from "decimal.js";
import { normalizeUnit } from "./match";

type MatchedRow = { unit: string; pricebookItemId: string | null };
type LinkedPrice = { pricebookItemId: string | null; referenceId: string | null; code: string | null; basis: string; currency: string; unit: string; amount: string; confirmed: boolean };
type Evidence = { item: { id: string; code: string; unit: string; unitPriceRial: string | null }; edition: { referenceId: string | null; status: string } };

/** Validate the stored attestation against the same imported row, not merely a similarly named price. */
export function pricebookLinkIssue(row: MatchedRow, price: LinkedPrice | undefined, evidence: Evidence | undefined): string | null {
  if (!row.pricebookItemId && !price?.pricebookItemId) return null; // manual prices have their own source controls
  if (!row.pricebookItemId || !price || row.pricebookItemId !== price.pricebookItemId || !evidence || evidence.item.id !== row.pricebookItemId) {
    return "پیوند تطبیق فهرست‌بها ناقص است؛ ردیف را دوباره تطبیق و تأیید کنید.";
  }
  const item = evidence.item;
  if (evidence.edition.status === "draft" || !evidence.edition.referenceId || price.referenceId !== evidence.edition.referenceId ||
      price.basis !== "official" || price.currency !== "IRR" || !price.confirmed || price.code !== item.code ||
      price.unit !== row.unit || normalizeUnit(item.unit) !== normalizeUnit(row.unit) || !item.unitPriceRial ||
      !new Decimal(price.amount).eq(item.unitPriceRial)) {
    return "بهای ثبت‌شده با ردیف و سند فهرست‌بها سازگار نیست؛ پیوند و قیمت را بازبینی و مجدداً تطبیق دهید.";
  }
  return null;
}
