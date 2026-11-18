// Persian rial to words — for formal market-grade reports.
// Lightweight, no external dependency. Covers up to 10^24 (septillion) which exceeds allowed total.
const ones = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"] as const;
const tens = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"] as const;
const hundreds = ["", "یکصد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"] as const;
const scales = ["", "هزار", "میلیون", "میلیارد", "هزار میلیارد", "میلیارد میلیارد"] as const;

function threeDigitsToFa(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "یکصد";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(hundreds[h]!);
  if (r) {
    if (r < 20) parts.push(ones[r]!);
    else {
      const t = Math.floor(r / 10);
      const o = r % 10;
      parts.push(o ? `${tens[t]!} و ${ones[o]!}` : tens[t]!);
    }
  }
  return parts.join(" و ");
}

export function rialToWordsFa(value: string | number): string {
  const raw = String(value).replace(/[^\d]/g, "");
  if (!raw || /^0+$/.test(raw)) return "صفر ریال";
  // split into 3-digit groups
  const groups: number[] = [];
  for (let i = raw.length; i > 0; i -= 3) groups.push(Number(raw.slice(Math.max(0, i - 3), i)));
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const w = threeDigitsToFa(groups[i]!);
    if (!w) continue;
    const scale = scales[i] ?? `×۱۰^${i * 3}`;
    words.push(scale ? `${w} ${scale}`.trim() : w);
  }
  return `${words.join(" و ")} ریال`.replace(/\s+/g, " ").trim();
}

// For testing: deterministic
export function __threeDigitsToFa(n: number): string { return threeDigitsToFa(n); }
