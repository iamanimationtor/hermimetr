// Preserve every stored digit instead of converting financial/measurement values to IEEE-754.
export function formatPersianDecimal(value: string | number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return "—";
  const whole = new Intl.NumberFormat("fa-IR").format(BigInt(match[2]));
  const fraction = match[3]?.replace(/0+$/, "") ?? "";
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return `${match[1] ? "−" : ""}${whole}${fraction ? `٫${fraction.replace(/\d/g, (digit) => digits[Number(digit)])}` : ""}`;
}

export { rialToWordsFa } from "./rial-words";
