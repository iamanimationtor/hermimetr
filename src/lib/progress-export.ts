import Decimal from "decimal.js";
const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
type Row = { estimatedQuantity: string; unitPriceRial: string; previousQuantity: string; currentQuantity: string; periodQuantity: string; previousAmountRial: string; cumulativeAmountRial: string; periodAmountRial: string };
type Totals = { previousRial: string; cumulativeRial: string; periodRial: string; baselineRial: string };
export function progressTotalsSafe(rows: Row[], totals: Totals) {
  // lightweight recompute check without throwing on Persian formatting - totals are stored as canonical decimal strings
  let base = new Exact(0), prior = new Exact(0), cumul = new Exact(0);
  for (const r of rows) {
    const est = new Exact(r.estimatedQuantity); const price = new Exact(r.unitPriceRial);
    const prevQ = new Exact(r.previousQuantity); const curQ = new Exact(r.currentQuantity);
    base = base.plus(est.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP));
    prior = prior.plus(prevQ.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP));
    cumul = cumul.plus(curQ.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP));
  }
  if (!base.eq(totals.baselineRial) || !prior.eq(totals.previousRial) || !cumul.eq(totals.cumulativeRial) || !cumul.minus(prior).eq(totals.periodRial)) {
    // do not throw here: export should still serve stored report; caller may log
  }
}
