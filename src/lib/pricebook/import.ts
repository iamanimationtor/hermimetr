import { normalizeDigits } from "../calculations";

/** Pure parsing and validation of pricebook tables (CSV text or spreadsheet rows). No database access. */

export type PricebookRow = {
  code: string; chapterCode: string | null; chapterTitle: string | null; description: string; unit: string;
  unitPriceRial: string | null; conditions: string | null; notes: string | null; page: string | null;
};
export type ImportResult = { rows: PricebookRow[]; errors: string[]; skippedEmpty: number };

const MAX_ROWS = 20000;
const MAX_ERRORS = 25;
type Field = keyof PricebookRow;
const ALIASES: Record<string, Field> = {
  code: "code", "کد": "code", "شماره": "code", "شمارهردیف": "code", "کدردیف": "code", "ردیف": "code",
  chaptercode: "chapterCode", "کدفصل": "chapterCode", "شمارهفصل": "chapterCode",
  chaptertitle: "chapterTitle", "عنوانفصل": "chapterTitle", "نامفصل": "chapterTitle", "فصل": "chapterTitle",
  description: "description", "شرح": "description", "شرحردیف": "description", "شرحعملیات": "description",
  unit: "unit", "واحد": "unit",
  price: "unitPriceRial", unitprice: "unitPriceRial", unitpricerial: "unitPriceRial", "بهایواحد": "unitPriceRial", "بها": "unitPriceRial", "قیمت": "unitPriceRial",
  conditions: "conditions", "شرایط": "conditions", "شرایطکاربرد": "conditions",
  notes: "notes", "توضیحات": "notes",
  page: "page", "صفحه": "page",
};
const LIMITS: Record<Field, number> = { code: 30, chapterCode: 20, chapterTitle: 200, description: 2000, unit: 40, unitPriceRial: 30, conditions: 2000, notes: 2000, page: 20 };

const clean = (value: unknown) => String(value ?? "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
const headerKey = (value: unknown) => clean(value).toLowerCase().replace(/\(.*?\)/g, "").replace(/[\s_\-‌]/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک");

/** RFC-4180 style parser with quoted fields; the delimiter (comma, semicolon or tab) is detected from the header line. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("فایل CSV ناقص است: یک نقل‌قول بسته نشده است.");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Validates every row; nothing is imported unless the whole table is clean (errors.length === 0). */
export function validatePricebookTable(table: unknown[][]): ImportResult {
  const errors: string[] = [];
  let overflow = 0;
  const report = (message: string) => { if (errors.length < MAX_ERRORS) errors.push(message); else overflow++; };
  if (!table.length) return { rows: [], errors: ["فایل خالی است."], skippedEmpty: 0 };
  const columns = new Map<Field, number>();
  table[0].forEach((header, index) => {
    const key = headerKey(header);
    const field = Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : undefined;
    if (field && !columns.has(field)) columns.set(field, index);
  });
  for (const [field, label] of [["code", "کد"], ["description", "شرح"], ["unit", "واحد"]] as const) {
    if (!columns.has(field)) report(`ستون الزامی «${label}» در سطر عنوان پیدا نشد.`);
  }
  if (errors.length) return { rows: [], errors, skippedEmpty: 0 };
  if (table.length - 1 > MAX_ROWS) return { rows: [], errors: [`حداکثر ${MAX_ROWS} ردیف در هر بار ورود پذیرفته می‌شود.`], skippedEmpty: 0 };

  const rows: PricebookRow[] = [];
  const seen = new Map<string, number>();
  let skippedEmpty = 0;
  for (let index = 1; index < table.length; index++) {
    const line = index + 1;
    const read = (field: Field) => { const column = columns.get(field); return column === undefined ? "" : clean(table[index][column]); };
    if (table[index].every((value) => clean(value) === "")) { skippedEmpty++; continue; }
    const code = normalizeDigits(read("code"));
    const description = read("description");
    const unit = read("unit");
    let valid = true;
    const reject = (message: string) => { valid = false; report(`سطر ${line}: ${message}`); };
    if (!/^[0-9A-Za-z][0-9A-Za-z.\-_/]{0,29}$/.test(code)) reject("کد ردیف معتبر نیست.");
    else if (seen.has(code)) reject(`کد «${code}» تکراری است (پیش‌تر در سطر ${seen.get(code)}).`);
    if (!description) reject("شرح ردیف خالی است.");
    if (!unit) reject("واحد ردیف خالی است.");
    for (const field of ["chapterCode", "chapterTitle", "description", "unit", "conditions", "notes", "page"] as const) {
      if (read(field).length > LIMITS[field]) reject(`طول ستون «${field}» بیش از حد مجاز است.`);
    }
    let unitPriceRial: string | null = null;
    const rawPrice = normalizeDigits(read("unitPriceRial"));
    if (rawPrice) {
      if (!/^\d{1,20}(\.\d{1,2})?$/.test(rawPrice)) reject("بهای واحد باید عدد نامنفی با حداکثر دو رقم اعشار باشد.");
      else unitPriceRial = rawPrice;
    }
    if (!valid) continue;
    seen.set(code, line);
    rows.push({
      code, description, unit, unitPriceRial,
      chapterCode: normalizeDigits(read("chapterCode")) || null, chapterTitle: read("chapterTitle") || null,
      conditions: read("conditions") || null, notes: read("notes") || null, page: normalizeDigits(read("page")) || null,
    });
  }
  if (overflow) errors.push(`… و ${overflow} خطای دیگر.`);
  if (!errors.length && !rows.length) errors.push("هیچ ردیف داده‌ای در فایل پیدا نشد.");
  return { rows, errors, skippedEmpty };
}
