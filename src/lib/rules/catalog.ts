import type { RuleCitation, RuleDefinition, RuleList, RuleParameter } from "./engine";

/**
 * System rule bank. Entries are immutable: any change must be published as a new version number.
 *
 * Two kinds of entries live here:
 *  - basis "geometric": mathematical identities, verified by the reference cases. They make no regulatory claim.
 *  - basis "regulatory" + sourceStatus "unverified": DRAFTS of measurement provisions that were only seen on
 *    intermediary websites. The engine treats their results as provisional and refuses to confirm them until an
 *    expert re-issues them as a workspace version citing a verified official document.
 */

const dim = (key: string, label: string, extra: Partial<RuleParameter> = {}): RuleParameter =>
  ({ key, label, unit: "متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4, ...extra });
const count = (key: string, label = "تعداد تکرار", extra: Partial<RuleParameter> = {}): RuleParameter =>
  ({ key, label, unit: "عدد", kind: "integer", min: "1", scale: 0, default: "1", ...extra });

const GEOMETRIC_SCOPE = "هر پروژه، فقط به‌عنوان مقدار هندسی. شمول و نحوه پرداخت تابع اسناد پیمان و ضوابط معتبر است.";
const geometricExceptions = (pointer: string) =>
  `ضوابط اختصاصی فهرست‌بها (آستانه‌های کسر، اضافه‌بها و شرایط پرداخت) در این نسخه اعمال نمی‌شود. ${pointer}`;
const geometric = {
  discipline: "ابنیه", basis: "geometric" as const, rounding: { scale: 4, mode: "half_up" as const },
  additions: "هیچ اضافه‌ای اعمال نمی‌شود.", citations: [] as RuleCitation[], validFrom: null, validTo: null,
  sourceStatus: "not_applicable" as const, scope: GEOMETRIC_SCOPE,
};

const UNVERIFIED_NOTE = "متن از منابع واسط نقل شده و با نسخه رسمی سامانه ضوابط (sama.mporg.ir) تطبیق داده نشده است.";
const abnieh = (clause: string, quote: string, note = UNVERIFIED_NOTE): RuleCitation => ({
  documentKey: "abnieh-1404", documentTitle: "فهرست‌بهای واحد پایه رشته ابنیه سال ۱۴۰۴", documentNumber: "1403/742948",
  documentDate: "1403/12/29", clause, page: "ثبت نشده — نسخه رسمی بازیابی نشد", quote, note,
});
const draft = {
  discipline: "ابنیه", basis: "regulatory" as const, rounding: { scale: 4, mode: "half_up" as const },
  additions: "اضافه‌بهاهای فصل در این قاعده محاسبه نمی‌شوند.", validFrom: "1404/01/01", validTo: null,
  sourceStatus: "unverified" as const,
  scope: "پس از تأیید سند و متخصص: برآوردهایی که این فهرست‌بها طبق اسناد پیمان مبنای آن‌هاست. تا آن زمان فقط محاسبه آزمایشی.",
};

const voids: RuleList = {
  key: "voids", label: "فضاهای خالی داخل عضو", help: "حفره، داکت یا چاله‌ای که داخل حجم عضو قرار دارد.",
  fields: [dim("v_length", "طول"), dim("v_width", "عرض"), dim("v_height", "ارتفاع"), count("v_count", "تعداد")],
};
const wallOpenings = (label: string): RuleList => ({
  key: "openings", label, fields: [dim("o_width", "عرض بازشو"), dim("o_height", "ارتفاع بازشو"), count("o_count", "تعداد")],
});
const prismParameters = [dim("length", "طول"), dim("width", "عرض"), dim("height", "ارتفاع / ضخامت"), count("count")];
const wallFaceParameters = [
  dim("length", "طول دیوار"), dim("height", "ارتفاع دیوار"),
  count("faces", "تعداد وجوه قالب‌بندی‌شده", { max: "2", default: "2" }), count("count"),
];
const wallAreaParameters = [dim("length", "طول دیوار"), dim("height", "ارتفاع دیوار"), count("count", "تعداد دیوار مشابه")];
const barFields = [dim("bar_length", "طول هر قطعه"), count("bar_count", "تعداد قطعه")];

export const SYSTEM_RULES: RuleDefinition[] = [
  /* ───────── بتن‌ریزی ───────── */
  {
    ...geometric, key: "concrete.prism", version: 1, title: "حجم هندسی عضو بتنی منشوری (پی، دیوار، تیر، دال)",
    operation: "بتن‌ریزی", outputKind: "volume", unit: "مترمکعب", parameters: prismParameters, lists: [voids],
    steps: [
      { key: "gross", label: "حجم ناخالص", expression: "length * width * height * count", unit: "مترمکعب" },
      { key: "void_volume", label: "حجم فضاهای خالی واردشده", expression: "sum(voids, v_length * v_width * v_height * v_count)", unit: "مترمکعب" },
      { key: "net", label: "حجم خالص هندسی", expression: "gross - void_volume", unit: "مترمکعب" },
    ],
    result: "net", constraints: [{ expression: "void_volume <= gross", message: "حجم فضاهای خالی از حجم ناخالص عضو بیشتر است." }],
    measurementRule: "حجم بر پایه ابعاد خالص عضو طبق نقشه محاسبه می‌شود: طول × عرض × ارتفاع × تعداد.",
    deductions: "همه فضاهای خالی واردشده توسط کاربر، بدون هیچ آستانه‌ای، کسر می‌شوند.",
    exceptions: geometricExceptions("برای ضابطه حفره‌های کوچک، نسخه ۲ این قاعده (پیش‌نویس تأییدنشده) را ببینید."),
  },
  {
    ...draft, key: "concrete.prism", version: 2, title: "حجم بتن عضو منشوری با ضابطه حفره‌های کوچک (پیش‌نویس تأییدنشده)",
    operation: "بتن‌ریزی", outputKind: "volume", unit: "مترمکعب", parameters: prismParameters, lists: [voids],
    steps: [
      { key: "gross", label: "حجم ناخالص", expression: "length * width * height * count", unit: "مترمکعب" },
      { key: "void_volume", label: "حجم حفره‌های قابل کسر (هر حفره بزرگ‌تر از ۰٫۰۵ مترمکعب)", expression: "sum(voids, if(v_length * v_width * v_height <= 0.05, 0, v_length * v_width * v_height) * v_count)", unit: "مترمکعب" },
      { key: "net", label: "حجم قابل اندازه‌گیری", expression: "gross - void_volume", unit: "مترمکعب" },
    ],
    result: "net", constraints: [{ expression: "void_volume <= gross", message: "حجم حفره‌ها از حجم ناخالص عضو بیشتر است." }],
    measurementRule: "حجم بتن طبق ابعاد نقشه محاسبه می‌شود؛ حفره‌ای که حجم هر یک از آن ۰٫۰۵ مترمکعب یا کمتر است از حجم بتن کسر نمی‌شود.",
    deductions: "فقط حفره‌هایی کسر می‌شوند که حجم هر یک بیش از ۰٫۰۵ مترمکعب باشد.",
    exceptions: "آستانه برای حجم «هر حفره» به‌تنهایی سنجیده می‌شود، نه مجموع حفره‌ها. سایر بندهای فصل در این قاعده پوشش داده نشده‌اند.",
    citations: [abnieh("فصل هشتم (بتن درجا)، «الزامات عمومی»، بند ۶",
      "حجم حفره‌های تعبیه شده در بتن که حجم هر یک از آن‌ها ۰٫۰۵ مترمکعب یا کمتر باشد، در اندازه‌گیری از حجم بتن کسر نمی‌گردد.",
      `${UNVERIFIED_NOTE} شماره این بند در ویرایش‌های قدیمی‌تر متفاوت دیده شده است.`)],
    supersedes: null, changeNote: "پیش‌نویس اولیه بر پایه شناسایی از منابع واسط؛ نیازمند تطبیق با متن رسمی.",
  },
  {
    ...geometric, key: "concrete.cylinder", version: 1, title: "حجم هندسی عضو بتنی دایره‌ای (ستون، شمع)",
    operation: "بتن‌ریزی", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("diameter", "قطر مقطع"), dim("height", "ارتفاع / طول"), count("count")],
    steps: [
      { key: "section_area", label: "سطح مقطع دایره", expression: "PI * diameter * diameter / 4", unit: "مترمربع" },
      { key: "volume", label: "حجم هندسی", expression: "section_area * height * count", unit: "مترمکعب" },
    ],
    result: "volume",
    measurementRule: "حجم برابر سطح مقطع دایره (π × قطر² ÷ ۴) ضرب در ارتفاع و تعداد است.",
    deductions: "کسری اعمال نمی‌شود.", exceptions: geometricExceptions("عدد π با ۴۰ رقم معنادار به‌کار می‌رود."),
  },
  {
    ...geometric, key: "concrete.slab_openings", version: 1, title: "حجم هندسی دال با بازشو",
    operation: "بتن‌ریزی", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("length", "طول دال"), dim("width", "عرض دال"), dim("thickness", "ضخامت دال")],
    lists: [{ key: "openings", label: "بازشوهای دال", fields: [dim("o_length", "طول بازشو"), dim("o_width", "عرض بازشو"), count("o_count", "تعداد")] }],
    steps: [
      { key: "gross_area", label: "سطح ناخالص دال", expression: "length * width", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده", expression: "sum(openings, o_length * o_width * o_count)", unit: "مترمربع" },
      { key: "net_area", label: "سطح خالص", expression: "gross_area - opening_area", unit: "مترمربع" },
      { key: "volume", label: "حجم هندسی", expression: "net_area * thickness", unit: "مترمکعب" },
    ],
    result: "volume", constraints: [{ expression: "opening_area <= gross_area", message: "سطح بازشوها از سطح دال بیشتر است." }],
    measurementRule: "سطح خالص دال (سطح ناخالص منهای بازشوها) ضرب در ضخامت.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، کسر می‌شوند.",
    exceptions: geometricExceptions("برای دال‌های مجوف، تیرچه‌بلوک یا ضخامت متغیر مناسب نیست."),
  },

  /* ───────── قالب‌بندی ───────── */
  {
    ...geometric, key: "formwork.footing_sides", version: 1, title: "سطح تماس هندسی قالب جانبی پی مستطیلی",
    operation: "قالب‌بندی", outputKind: "area", unit: "مترمربع",
    parameters: [dim("length", "طول پی"), dim("width", "عرض پی"), dim("height", "ارتفاع پی"), count("count")],
    steps: [
      { key: "perimeter", label: "محیط پی", expression: "2 * (length + width)", unit: "متر" },
      { key: "area", label: "سطح جانبی", expression: "perimeter * height * count", unit: "مترمربع" },
    ],
    result: "area",
    measurementRule: "سطح جانبی پی برابر محیط × ارتفاع × تعداد است؛ کف و روی پی قالب‌بندی نمی‌شود.",
    deductions: "وجوهی که به پی مجاور یا خاک متکی است باید جداگانه کنترل و در صورت لزوم ردیف دیگری ثبت شود؛ این قاعده کسری اعمال نمی‌کند.",
    exceptions: geometricExceptions("ملاک «سطح در تماس با بتن» در فصل‌های قالب‌بندی فهرست‌بها ذکر شده اما هنوز تأیید نشده است."),
  },
  {
    ...geometric, key: "formwork.column_rect", version: 1, title: "سطح تماس هندسی قالب ستون مستطیلی",
    operation: "قالب‌بندی", outputKind: "area", unit: "مترمربع",
    parameters: [dim("side_a", "بعد اول مقطع"), dim("side_b", "بعد دوم مقطع"), dim("height", "ارتفاع قالب‌بندی"), count("count")],
    steps: [
      { key: "perimeter", label: "محیط مقطع", expression: "2 * (side_a + side_b)", unit: "متر" },
      { key: "area", label: "سطح تماس", expression: "perimeter * height * count", unit: "مترمربع" },
    ],
    result: "area",
    measurementRule: "سطح تماس برابر محیط مقطع × ارتفاع قالب‌بندی × تعداد است.",
    deductions: "سطح اتصال تیر به ستون کسر نمی‌شود مگر کاربر ارتفاع را خالص وارد کند.",
    exceptions: geometricExceptions("مبنای ارتفاع (از روی پی یا کف طبقه) باید طبق ضابطه معتبر تعیین شود."),
  },
  {
    ...geometric, key: "formwork.beam_drop", version: 1, title: "سطح تماس هندسی قالب تیر آویز زیر دال",
    operation: "قالب‌بندی", outputKind: "area", unit: "مترمربع",
    parameters: [
      dim("beam_width", "عرض تیر"), dim("beam_depth", "ارتفاع کل تیر"),
      dim("slab_thickness", "ضخامت دال روی تیر", { exclusiveMin: false, default: "0" }), dim("length", "طول آزاد تیر"), count("count"),
    ],
    steps: [
      { key: "side_height", label: "ارتفاع هر گونه زیر دال", expression: "beam_depth - slab_thickness", unit: "متر" },
      { key: "contact_width", label: "عرض گسترده تماس (کف + دو گونه)", expression: "beam_width + 2 * side_height", unit: "متر" },
      { key: "area", label: "سطح تماس", expression: "contact_width * length * count", unit: "مترمربع" },
    ],
    result: "area", constraints: [{ expression: "slab_thickness < beam_depth", message: "ضخامت دال باید از ارتفاع کل تیر کمتر باشد." }],
    measurementRule: "کف تیر به‌علاوه دو گونه (ارتفاع تیر منهای ضخامت دال) ضرب در طول آزاد و تعداد.",
    deductions: "محل تقاطع تیرها کسر نمی‌شود؛ طول باید خالص وارد شود.",
    exceptions: geometricExceptions("برای تیر لبه (یک گونه بلند) باید قاعده جداگانه تعریف شود."),
  },
  {
    ...geometric, key: "formwork.wall_faces", version: 1, title: "سطح تماس هندسی قالب دیوار بتنی",
    operation: "قالب‌بندی", outputKind: "area", unit: "مترمربع", parameters: wallFaceParameters,
    lists: [wallOpenings("بازشوهای دیوار")],
    steps: [
      { key: "gross_face", label: "سطح ناخالص یک وجه", expression: "length * height", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده در یک وجه", expression: "sum(openings, o_width * o_height * o_count)", unit: "مترمربع" },
      { key: "net_face", label: "سطح خالص یک وجه", expression: "gross_face - opening_area", unit: "مترمربع" },
      { key: "area", label: "سطح تماس کل", expression: "net_face * faces * count", unit: "مترمربع" },
    ],
    result: "area", constraints: [{ expression: "opening_area <= gross_face", message: "سطح بازشوها از سطح یک وجه دیوار بیشتر است." }],
    measurementRule: "سطح خالص هر وجه (طول × ارتفاع منهای بازشوها) ضرب در تعداد وجوه و تعداد دیوار.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، از هر وجه کسر می‌شوند.",
    exceptions: geometricExceptions("برای ضابطه قالب یکسره در محل بازشو، نسخه ۲ (پیش‌نویس تأییدنشده) را ببینید."),
  },
  {
    ...draft, key: "formwork.wall_faces", version: 2, title: "سطح قالب‌بندی دیوار با ضابطه قالب یکسره در بازشو (پیش‌نویس تأییدنشده)",
    operation: "قالب‌بندی", outputKind: "area", unit: "مترمربع",
    parameters: [...wallFaceParameters, {
      key: "continuous", label: "قالب در محل بازشو یکسره و غیرقابل قطع است؟ (۱ = بله، ۰ = خیر)", unit: "—", kind: "integer",
      min: "0", max: "1", scale: 0, default: "0", help: "شرط اجرایی باید در نقشه یا دستور کار مستند باشد.",
    }],
    lists: [wallOpenings("بازشوهای دیوار")],
    steps: [
      { key: "gross_face", label: "سطح ناخالص یک وجه", expression: "length * height", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای قابل کسر", expression: "if(continuous == 1, 0, sum(openings, o_width * o_height * o_count))", unit: "مترمربع" },
      { key: "net_face", label: "سطح قابل اندازه‌گیری یک وجه", expression: "gross_face - opening_area", unit: "مترمربع" },
      { key: "area", label: "سطح قالب‌بندی", expression: "net_face * faces * count", unit: "مترمربع" },
    ],
    result: "area", constraints: [{ expression: "opening_area <= gross_face", message: "سطح بازشوها از سطح یک وجه دیوار بیشتر است." }],
    measurementRule: "سطوحی از قالب که در تماس با بتن است ملاک اندازه‌گیری است.",
    deductions: "بازشوها کسر می‌شوند، مگر قالب به‌صورت یکسره در محل بازشو اجرا و غیرقابل قطع باشد که در این حالت سطح بازشو کسر نمی‌شود.",
    exceptions: "پخ نبش یا گردی گوشه قالب از سطح کار کسر نمی‌شود. تشخیص «غیرقابل قطع بودن» با اسناد اجرایی است، نه سامانه.",
    citations: [
      abnieh("فصل‌های پنجم و ششم (قالب‌بندی)، «الزامات عمومی»، بند ۲", "در اندازه‌گیری قالب‌بندی‌ها، سطوحی از قالب که در تماس با بتن است، ملاک محاسبه قرار می‌گیرد."),
      abnieh("فصل پنجم (قالب‌بندی غیرفولادی)، «الزامات عمومی»، بند ۹", "در مواردی که قالب باید به صورت یکسره در محل بازشوها اجرا و غیر قابل قطع باشد، سطح قالب اجرا شده در محل بازشوها، از سطح قالب‌بندی سازه کسر نمی‌شود."),
    ],
    supersedes: null, changeNote: "پیش‌نویس اولیه بر پایه شناسایی از منابع واسط؛ نیازمند تطبیق با متن رسمی.",
  },

  /* ───────── آرماتوربندی ───────── */
  {
    ...geometric, key: "rebar.mass_from_unit_mass", version: 1, title: "جرم میلگرد از طول برش و جرم واحد طول",
    operation: "آرماتوربندی", outputKind: "weight", unit: "کیلوگرم", parameters: [],
    lists: [{
      key: "bars", label: "ردیف‌های لیستوفر", minItems: 1, maxItems: 120,
      help: "جرم واحد طول را از جدول استاندارد یا کارخانه سازنده وارد کنید.",
      fields: [...barFields, { key: "unit_mass", label: "جرم واحد طول", unit: "کیلوگرم بر متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4 }],
    }],
    steps: [
      { key: "total_length", label: "طول کل میلگرد", expression: "sum(bars, bar_length * bar_count)", unit: "متر" },
      { key: "mass", label: "جرم کل", expression: "sum(bars, bar_length * bar_count * unit_mass)", unit: "کیلوگرم" },
    ],
    result: "mass",
    measurementRule: "جرم هر ردیف برابر طول قطعه × تعداد × جرم واحد طول است و جرم کل مجموع ردیف‌هاست.",
    deductions: "کسری اعمال نمی‌شود. پرت، هم‌پوشانی و خم فقط در صورتی منظور می‌شود که در طول برش واردشده لحاظ شده باشد.",
    exceptions: geometricExceptions("مبنای وزن (جدول استاندارد یا کارخانه) در فصل هفتم فهرست‌بها ذکر شده اما هنوز تأیید نشده است."),
  },
  {
    ...geometric, key: "rebar.mass_theoretical", version: 1, title: "جرم نظری میلگرد از قطر اسمی و چگالی",
    operation: "آرماتوربندی", outputKind: "weight", unit: "کیلوگرم",
    parameters: [{
      key: "density", label: "چگالی فولاد", unit: "کیلوگرم بر مترمکعب", kind: "decimal", min: "0", exclusiveMin: true, scale: 2,
      help: "مقدار باید از استاندارد محصول یا مشخصات فنی پروژه گرفته شود؛ سامانه مقدار پیش‌فرضی اعمال نمی‌کند.",
    }],
    lists: [{
      key: "bars", label: "ردیف‌های لیستوفر", minItems: 1, maxItems: 120,
      fields: [{ key: "diameter_mm", label: "قطر اسمی", unit: "میلی‌متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 2 }, ...barFields],
    }],
    steps: [
      { key: "total_length", label: "طول کل میلگرد", expression: "sum(bars, bar_length * bar_count)", unit: "متر" },
      { key: "mass", label: "جرم نظری کل", expression: "sum(bars, PI * (diameter_mm / 1000) * (diameter_mm / 1000) / 4 * density * bar_length * bar_count)", unit: "کیلوگرم" },
    ],
    result: "mass",
    measurementRule: "جرم هر ردیف = سطح مقطع اسمی (π × قطر² ÷ ۴، با تبدیل میلی‌متر به متر) × چگالی × طول × تعداد.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("جرم نظری با جرم جدول کارخانه می‌تواند تفاوت داشته باشد؛ مبنای پرداخت را اسناد پیمان تعیین می‌کند."),
  },

  /* ───────── خاک‌برداری ───────── */
  {
    ...geometric, key: "earthwork.box", version: 1, title: "حجم هندسی گود مستطیلی با دیواره قائم",
    operation: "خاک‌برداری", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("length", "طول گود"), dim("width", "عرض گود"), dim("depth", "عمق گود")],
    steps: [{ key: "volume", label: "حجم درجا", expression: "length * width * depth", unit: "مترمکعب" }],
    result: "volume",
    measurementRule: "حجم درجا برابر طول × عرض × عمق است.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("ضریب تورم، اضافه‌عرض اجرایی و تفکیک نوع زمین اعمال نمی‌شود."),
  },
  {
    ...geometric, key: "earthwork.prismoid_pit", version: 1, title: "حجم هندسی گود مستطیلی با دیواره شیب‌دار",
    operation: "خاک‌برداری", outputKind: "volume", unit: "مترمکعب",
    parameters: [
      dim("bottom_length", "طول کف گود"), dim("bottom_width", "عرض کف گود"), dim("depth", "عمق گود"),
      { key: "slope", label: "شیب دیواره (نسبت افقی به قائم)", unit: "بدون واحد", kind: "decimal", min: "0", scale: 4, default: "0", help: "برای دیواره قائم صفر وارد کنید." },
    ],
    steps: [
      { key: "top_length", label: "طول دهانه بالا", expression: "bottom_length + 2 * slope * depth", unit: "متر" },
      { key: "top_width", label: "عرض دهانه بالا", expression: "bottom_width + 2 * slope * depth", unit: "متر" },
      { key: "bottom_area", label: "سطح کف", expression: "bottom_length * bottom_width", unit: "مترمربع" },
      { key: "mid_area", label: "سطح مقطع میانی", expression: "(bottom_length + slope * depth) * (bottom_width + slope * depth)", unit: "مترمربع" },
      { key: "top_area", label: "سطح دهانه بالا", expression: "top_length * top_width", unit: "مترمربع" },
      { key: "volume", label: "حجم درجا (رابطه منشورگون)", expression: "depth / 6 * (bottom_area + 4 * mid_area + top_area)", unit: "مترمکعب" },
    ],
    result: "volume",
    measurementRule: "حجم با رابطه منشورگون محاسبه می‌شود: عمق ÷ ۶ × (سطح کف + ۴ × سطح میانی + سطح بالا)؛ برای این هندسه دقیق است.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("فقط برای گود با شیب یکسان در چهار دیواره و کف تراز معتبر است."),
  },
  {
    ...geometric, key: "earthwork.trench_trapezoid", version: 1, title: "حجم هندسی ترانشه با مقطع ذوزنقه‌ای",
    operation: "خاک‌برداری", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("bottom_width", "عرض کف"), dim("top_width", "عرض بالا"), dim("depth", "عمق"), dim("length", "طول ترانشه")],
    steps: [
      { key: "section_area", label: "سطح مقطع ذوزنقه", expression: "(bottom_width + top_width) / 2 * depth", unit: "مترمربع" },
      { key: "volume", label: "حجم درجا", expression: "section_area * length", unit: "مترمکعب" },
    ],
    result: "volume", constraints: [{ expression: "top_width >= bottom_width", message: "عرض بالا نباید از عرض کف کمتر باشد." }],
    measurementRule: "سطح مقطع ذوزنقه (میانگین دو عرض × عمق) ضرب در طول ترانشه.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("برای مقطع ثابت در طول مسیر معتبر است."),
  },

  /* ───────── دیوارچینی ───────── */
  {
    ...geometric, key: "masonry.wall_area_net", version: 1, title: "سطح خالص هندسی دیوارچینی",
    operation: "دیوارچینی", outputKind: "area", unit: "مترمربع", parameters: wallAreaParameters,
    lists: [wallOpenings("بازشوها (مجموع برای همه دیوارهای مشابه)")],
    steps: [
      { key: "gross", label: "سطح ناخالص", expression: "length * height * count", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده", expression: "sum(openings, o_width * o_height * o_count)", unit: "مترمربع" },
      { key: "net", label: "سطح خالص هندسی", expression: "gross - opening_area", unit: "مترمربع" },
    ],
    result: "net", constraints: [{ expression: "opening_area <= gross", message: "سطح بازشوها از سطح ناخالص دیوار بیشتر است." }],
    measurementRule: "سطح ناخالص (طول × ارتفاع × تعداد) منهای سطح بازشوهای واردشده.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، کسر می‌شوند.",
    exceptions: geometricExceptions("برای ضابطه حفره‌های کوچک، نسخه ۲ (پیش‌نویس تأییدنشده) را ببینید."),
  },
  {
    ...draft, key: "masonry.wall_area_net", version: 2, title: "سطح دیوارچینی با ضابطه حفره‌های کوچک (پیش‌نویس تأییدنشده)",
    operation: "دیوارچینی", outputKind: "area", unit: "مترمربع", parameters: wallAreaParameters,
    lists: [wallOpenings("بازشوها و حفره‌ها (مجموع برای همه دیوارهای مشابه)")],
    steps: [
      { key: "gross", label: "سطح ناخالص", expression: "length * height * count", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای قابل کسر (هر یک ۰٫۰۵ مترمربع یا بیشتر)", expression: "sum(openings, if(o_width * o_height < 0.05, 0, o_width * o_height) * o_count)", unit: "مترمربع" },
      { key: "net", label: "سطح قابل اندازه‌گیری", expression: "gross - opening_area", unit: "مترمربع" },
    ],
    result: "net", constraints: [{ expression: "opening_area <= gross", message: "سطح بازشوها از سطح ناخالص دیوار بیشتر است." }],
    measurementRule: "سطح دیوار طبق ابعاد نقشه؛ حفره یا سوراخ با سطح مقطع کمتر از ۰٫۰۵ مترمربع از مقدار کار کسر نمی‌شود.",
    deductions: "بازشوهایی کسر می‌شوند که سطح مقطع هر یک ۰٫۰۵ مترمربع یا بیشتر باشد.",
    exceptions: "واحد اندازه‌گیری ردیف (سطح یا حجم برحسب ضخامت دیوار) و ضوابط نعل‌درگاه در این قاعده پوشش داده نشده است.",
    citations: [abnieh("فصل یازدهم (آجرکاری و شفته‌ریزی)، «الزامات عمومی»، بند ۵",
      "بابت تعبیه حفره یا سوراخ با سطح مقطع کمتر از ۰٫۰۵ مترمربع که در حین دیوارچینی، آجرکاری یا طاق‌زنی انجام می‌گردد، پرداخت جداگانه‌ای صورت نمی‌گیرد و مقدار آن از عملیات مربوط کسر نمی‌گردد.",
      `${UNVERIFIED_NOTE} این بند فقط در یک منبع واسط دیده شده است.`)],
    supersedes: null, changeNote: "پیش‌نویس اولیه بر پایه شناسایی از منابع واسط؛ نیازمند تطبیق با متن رسمی.",
  },
  {
    ...geometric, key: "masonry.wall_volume_net", version: 1, title: "حجم خالص هندسی دیوارچینی",
    operation: "دیوارچینی", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("length", "طول دیوار"), dim("height", "ارتفاع دیوار"), dim("thickness", "ضخامت دیوار")],
    lists: [wallOpenings("بازشوها")],
    steps: [
      { key: "gross_area", label: "سطح ناخالص", expression: "length * height", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده", expression: "sum(openings, o_width * o_height * o_count)", unit: "مترمربع" },
      { key: "net_area", label: "سطح خالص", expression: "gross_area - opening_area", unit: "مترمربع" },
      { key: "volume", label: "حجم خالص هندسی", expression: "net_area * thickness", unit: "مترمکعب" },
    ],
    result: "volume", constraints: [{ expression: "opening_area <= gross_area", message: "سطح بازشوها از سطح دیوار بیشتر است." }],
    measurementRule: "سطح خالص دیوار (طول × ارتفاع منهای بازشوها) ضرب در ضخامت.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، کسر می‌شوند.",
    exceptions: geometricExceptions("ضخامت اسمی آجرکاری و ضوابط نعل‌درگاه اعمال نمی‌شود."),
  },
  /* ───────── اندودکاری ───────── */
  {
    ...geometric, key: "plaster.wall_face_area", version: 1, title: "سطح خالص هندسی اندودکاری وجه دیوار",
    operation: "اندودکاری", outputKind: "area", unit: "مترمربع",
    parameters: [dim("length", "طول دیوار"), dim("height", "ارتفاع دیوار"), count("count", "تعداد دیوار مشابه")],
    lists: [wallOpenings("بازشوهای دیوار (مجموع برای همه دیوارهای مشابه)")],
    steps: [
      { key: "gross", label: "سطح ناخالص", expression: "length * height * count", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده", expression: "sum(openings, o_width * o_height * o_count)", unit: "مترمربع" },
      { key: "net", label: "سطح خالص هندسی", expression: "gross - opening_area", unit: "مترمربع" },
    ],
    result: "net", constraints: [{ expression: "opening_area <= gross", message: "سطح بازشوها از سطح ناخالص بیشتر است." }],
    measurementRule: "سطح ناخالص (طول × ارتفاع × تعداد) منهای سطح بازشوهای واردشده.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، کسر می‌شوند.",
    exceptions: `مبنای اندازه‌گیری در فصل مربوط به اندودکاری طبق منابع واسط «سطح روی اندود» ذکر شده، اما این سند تأیید نشده و در این قاعده اعمال نشده است. ${geometricExceptions("")}`,
  },
  {
    ...geometric, key: "plaster.ceiling_area", version: 1, title: "سطح خالص هندسی اندودکاری سقف",
    operation: "اندودکاری", outputKind: "area", unit: "مترمربع", parameters: [dim("length", "طول سقف"), dim("width", "عرض سقف")],
    lists: [{ key: "openings", label: "بازشوها و حفره‌های سقف", fields: [dim("o_length", "طول بازشو"), dim("o_width", "عرض بازشو"), count("o_count", "تعداد")] }],
    steps: [
      { key: "gross", label: "سطح ناخالص سقف", expression: "length * width", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوهای واردشده", expression: "sum(openings, o_length * o_width * o_count)", unit: "مترمربع" },
      { key: "net", label: "سطح خالص هندسی", expression: "gross - opening_area", unit: "مترمربع" },
    ],
    result: "net", constraints: [{ expression: "opening_area <= gross", message: "سطح بازشوها از سطح سقف بیشتر است." }],
    measurementRule: "سطح ناخالص سقف منهای سطح بازشوهای واردشده.",
    deductions: "همه بازشوهای واردشده، بدون آستانه، کسر می‌شوند.",
    exceptions: geometricExceptions("ضوابط سقف شیبدار، سقف کاذب و اضافه‌بهای صعوبت اجرا اعمال نمی‌شود."),
  },
  {
    ...geometric, key: "plaster.mortar_volume", version: 1, title: "حجم هندسی ملات اندود",
    operation: "اندودکاری", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("length", "طول سطح"), dim("height", "ارتفاع / عرض سطح"), dim("thickness", "ضخامت اندود")],
    lists: [wallOpenings("بازشوهای سطح")],
    steps: [
      { key: "gross_area", label: "سطح ناخالص", expression: "length * height", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوها", expression: "sum(openings, o_width * o_height * o_count)", unit: "مترمربع" },
      { key: "net_area", label: "سطح خالص", expression: "gross_area - opening_area", unit: "مترمربع" },
      { key: "volume", label: "حجم ملات", expression: "net_area * thickness", unit: "مترمکعب" },
    ],
    result: "volume", constraints: [{ expression: "opening_area <= gross_area", message: "سطح بازشوها از سطح کار بیشتر است." }],
    measurementRule: "سطح خالص کار ضرب در ضخامت اندود.",
    deductions: "همه بازشوهای واردشده کسر می‌شوند.",
    exceptions: geometricExceptions("پرت ملات، ضخامت متغیر و ضوابط پرداخت فصل اندودکاری اعمال نمی‌شود."),
  },

  /* ───────── کف‌سازی ───────── */
  {
    ...geometric, key: "floor.screed_volume", version: 1, title: "حجم هندسی زیرسازی کف (ماسه‌سیمان / بتن سبک)",
    operation: "کف‌سازی", outputKind: "volume", unit: "مترمکعب",
    parameters: [dim("length", "طول کف"), dim("width", "عرض کف"), dim("thickness", "ضخامت زیرسازی"), count("count", "تعداد فضای مشابه")],
    steps: [{ key: "volume", label: "حجم زیرسازی", expression: "length * width * thickness * count", unit: "مترمکعب" }],
    result: "volume",
    measurementRule: "حجم زیرسازی برابر طول × عرض × ضخامت × تعداد است.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("ضریب شیب بیش از حد مجاز و ضوابط پرداخت فصل مربوط اعمال نمی‌شود."),
  },
  {
    ...geometric, key: "floor.finish_area", version: 1, title: "سطح خالص هندسی کف‌سازی نهایی",
    operation: "کف‌سازی", outputKind: "area", unit: "مترمربع", parameters: [dim("length", "طول کف"), dim("width", "عرض کف")],
    lists: [{ key: "openings", label: "بازشوها و حفره‌های کف", fields: [dim("o_length", "طول بازشو"), dim("o_width", "عرض بازشو"), count("o_count", "تعداد")] }],
    steps: [
      { key: "gross", label: "سطح ناخالص", expression: "length * width", unit: "مترمربع" },
      { key: "opening_area", label: "سطح بازشوها", expression: "sum(openings, o_length * o_width * o_count)", unit: "مترمربع" },
      { key: "net", label: "سطح خالص هندسی", expression: "gross - opening_area", unit: "مترمربع" },
    ],
    result: "net", constraints: [{ expression: "opening_area <= gross", message: "سطح بازشوها از سطح کف بیشتر است." }],
    measurementRule: "سطح ناخالص کف منهای سطح بازشوهای واردشده.",
    deductions: "همه بازشوهای واردشده کسر می‌شوند.",
    exceptions: geometricExceptions("سرشانه، قرنیز و ضوابط کف شیب‌دار اعمال نمی‌شود."),
  },
  {
    ...geometric, key: "floor.skirting_length", version: 1, title: "طول هندسی قرنیز / سرشانه از محیط فضای مستطیلی",
    operation: "کف‌سازی", outputKind: "length", unit: "متر",
    parameters: [dim("length", "طول فضا"), dim("width", "عرض فضا"), count("count", "تعداد فضای مشابه")],
    lists: [{ key: "openings", label: "بازشوهای مجاور قرنیز", help: "عرض هر بازشویی که قرنیز در مسیر آن اجرا نمی‌شود.", fields: [dim("o_width", "عرض بازشو"), count("o_count", "تعداد")] }],
    steps: [
      { key: "perimeter", label: "محیط کل", expression: "2 * (length + width) * count", unit: "متر" },
      { key: "opening_width", label: "عرض بازشوهای کسرشده", expression: "sum(openings, o_width * o_count)", unit: "متر" },
      { key: "net", label: "طول قرنیز", expression: "perimeter - opening_width", unit: "متر" },
    ],
    result: "net", constraints: [{ expression: "opening_width <= perimeter", message: "عرض بازشوها از محیط فضا بیشتر است." }],
    measurementRule: "محیط فضای مستطیلی ضرب در تعداد، منهای عرض بازشوهای واردشده.",
    deductions: "عرض بازشوهای واردشده کسر می‌شود.",
    exceptions: geometricExceptions("فقط برای فضای مستطیلی معتبر است؛ قرنیز دیوارهای میانی باید جداگانه وارد شود."),
  },

  /* ───────── عایق‌کاری ───────── */
  {
    ...geometric, key: "insulation.membrane_area", version: 1, title: "سطح هندسی عایق رطوبتی غشایی با لبه‌های عمودی (کرسی)",
    operation: "عایق‌کاری", outputKind: "area", unit: "مترمربع",
    parameters: [dim("length", "طول سطح افقی"), dim("width", "عرض سطح افقی"),
      { key: "upturn_length", label: "کل طول لبه‌های عمودی", unit: "متر", kind: "decimal", min: "0", scale: 4, default: "0", help: "مجموع طول ارتفاع‌گیری عایق روی دیوارها و همین‌طور پایه‌ها." },
      { key: "upturn_height", label: "ارتفاع لبه عمودی", unit: "متر", kind: "decimal", min: "0", scale: 4, default: "0" }],
    steps: [
      { key: "horizontal", label: "سطح افقی", expression: "length * width", unit: "مترمربع" },
      { key: "vertical", label: "سطح لبه‌های عمودی", expression: "upturn_length * upturn_height", unit: "مترمربع" },
      { key: "total", label: "سطح کل عایق", expression: "horizontal + vertical", unit: "مترمربع" },
    ],
    result: "total",
    measurementRule: "سطح افقی به‌علاوه سطح لبه‌های عمودی (طول لبه × ارتفاع لبه).",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("هم‌پوشانی لبه‌های غشا و پرت آن طبق مشخصات فنی محصول باید جداگانه لحاظ شود."),
  },
  {
    ...geometric, key: "insulation.board_area", version: 1, title: "سطح هندسی عایق صفحه‌ای روی سطوح جانبی",
    operation: "عایق‌کاری", outputKind: "area", unit: "مترمربع", parameters: [],
    lists: [{ key: "surfaces", label: "سطوح عایق‌کاری‌شده", minItems: 1, maxItems: 120,
      fields: [dim("s_length", "طول سطح"), dim("s_height", "ارتفاع سطح"), count("s_count", "تعداد")] }],
    steps: [{ key: "area", label: "سطح کل عایق", expression: "sum(surfaces, s_length * s_height * s_count)", unit: "مترمربع" }],
    result: "area",
    measurementRule: "مجموع سطح هر قطعه (طول × ارتفاع × تعداد).",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("درزگیری، چسب نصب و ضوابط پرداخت اعمال نمی‌شود."),
  },

  /* ───────── اسکلت فلزی ───────── */
  {
    ...geometric, key: "steel.member_mass", version: 1, title: "جرم اعضای فولادی از جرم واحد طول پروفیل",
    operation: "اسکلت فلزی", outputKind: "weight", unit: "کیلوگرم", parameters: [],
    lists: [{ key: "members", label: "ردیف‌های پروفیل", minItems: 1, maxItems: 120,
      help: "جرم واحد طول را از جدول کارخانه سازنده یا استاندارد محصول وارد کنید.",
      fields: [dim("m_length", "طول هر قطعه"), count("m_count", "تعداد قطعه"),
        { key: "unit_mass", label: "جرم واحد طول", unit: "کیلوگرم بر متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4 }] }],
    steps: [
      { key: "total_length", label: "طول کل اعضا", expression: "sum(members, m_length * m_count)", unit: "متر" },
      { key: "mass", label: "جرم کل", expression: "sum(members, m_length * m_count * unit_mass)", unit: "کیلوگرم" },
    ],
    result: "mass",
    measurementRule: "جرم هر ردیف برابر طول قطعه × تعداد × جرم واحد طول است و جرم کل مجموع ردیف‌هاست.",
    deductions: "کسری اعمال نمی‌شود. پرت، برش و اتصال فقط در صورتی منظور می‌شود که در طول واردشده لحاظ شده باشد.",
    exceptions: geometricExceptions("مبنای جرم واحد طول و ضوابط پرداخت فصل کارهای فولادی سنگین تأیید نشده است."),
  },
  {
    ...geometric, key: "steel.plate_mass", version: 1, title: "جرم هندسی ورق فولادی از ابعاد و چگالی",
    operation: "اسکلت فلزی", outputKind: "weight", unit: "کیلوگرم",
    parameters: [dim("length", "طول ورق"), dim("width", "عرض ورق"),
      { key: "thickness_mm", label: "ضخامت ورق", unit: "میلی‌متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 3 },
      { key: "density", label: "چگالی فولاد", unit: "کیلوگرم بر مترمکعب", kind: "decimal", min: "0", exclusiveMin: true, scale: 2,
        help: "مقدار را از استاندارد محصول یا مشخصات فنی پروژه بگیرید؛ سامانه مقدار پیش‌فرضی اعمال نمی‌کند." },
      count("count", "تعداد ورق مشابه")],
    steps: [
      { key: "thickness_m", label: "ضخامت بر حسب متر", expression: "thickness_mm / 1000", unit: "متر" },
      { key: "volume", label: "حجم ورق", expression: "length * width * thickness_m * count", unit: "مترمکعب" },
      { key: "mass", label: "جرم ورق", expression: "volume * density", unit: "کیلوگرم" },
    ],
    result: "mass",
    measurementRule: "حجم (طول × عرض × ضخامت با تبدیل میلی‌متر به متر × تعداد) ضرب در چگالی.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("رواداری تولید ورق و ضوابط پرداخت فصل فولادی تأیید نشده است."),
  },
  {
    ...geometric, key: "steel.section_paint_area", version: 1, title: "سطح هندسی رنگ‌آمیزی اعضای فولادی از محیط مقطع",
    operation: "اسکلت فلزی", outputKind: "area", unit: "مترمربع",
    parameters: [{ key: "section_perimeter", label: "محیط مقطع بازشده", unit: "متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4,
      help: "محیط سطح مقطع طبق جدول پروفیل یا اندازه‌گیری؛ برای مقاطع مرکب، مجموع محیط اجزای در معرض رنگ." },
      dim("length", "طول عضو"), count("count", "تعداد عضو مشابه")],
    steps: [{ key: "area", label: "سطح رنگ", expression: "section_perimeter * length * count", unit: "مترمربع" }],
    result: "area",
    measurementRule: "محیط مقطع × طول × تعداد.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("ضوابط آماده‌سازی سطح، تعداد لایه رنگ و ضریب صعوبت اعمال نمی‌شود."),
  },
  {
    ...geometric, key: "steel.connection_mass", version: 1, title: "جرم هندسی صفحات اتصال از لیست ابعاد",
    operation: "اسکلت فلزی", outputKind: "weight", unit: "کیلوگرم",
    parameters: [{ key: "density", label: "چگالی فولاد", unit: "کیلوگرم بر مترمکعب", kind: "decimal", min: "0", exclusiveMin: true, scale: 2,
      help: "مقدار را از استاندارد محصول یا مشخصات فنی پروژه بگیرید؛ سامانه مقدار پیش‌فرضی اعمال نمی‌کند." }],
    lists: [{ key: "plates", label: "ردیف‌های صفحه اتصال (گوسات و پایه)", minItems: 1, maxItems: 120,
      fields: [dim("p_length", "طول صفحه"), dim("p_width", "عرض صفحه"),
        { key: "p_thickness_mm", label: "ضخامت صفحه", unit: "میلی‌متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 3 }, count("p_count", "تعداد")] }],
    steps: [
      { key: "volume", label: "حجم صفحات", expression: "sum(plates, p_length * p_width * (p_thickness_mm / 1000) * p_count)", unit: "مترمکعب" },
      { key: "mass", label: "جرم صفحات", expression: "volume * density", unit: "کیلوگرم" },
    ],
    result: "mass",
    measurementRule: "مجموع حجم صفحات (طول × عرض × ضخامت با تبدیل میلی‌متر به متر × تعداد) ضرب در چگالی.",
    deductions: "کسری اعمال نمی‌شود.",
    exceptions: geometricExceptions("سوراخ‌های پیچ، جوش و پرت برش کسر نمی‌شود."),
  },
];

export const systemRuleRef = (def: Pick<RuleDefinition, "key" | "version">) => `sys:${def.key}@${def.version}`;
export const RULE_OPERATIONS = ["بتن‌ریزی", "قالب‌بندی", "آرماتوربندی", "خاک‌برداری", "دیوارچینی", "اندودکاری", "کف‌سازی", "عایق‌کاری", "اسکلت فلزی"];
