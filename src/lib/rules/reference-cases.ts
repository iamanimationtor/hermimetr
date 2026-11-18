import type { RuleInput } from "./engine";

/**
 * Reference calculations.
 * Every expected value below was worked out by hand (see handSteps) and is re-computed in the test-suite by an
 * independent exact-rational (BigInt) implementation that shares no code with the rule engine.
 * Review by a qualified engineer is a separate, human step that is recorded per workspace.
 */
export type ReferenceCase = {
  id: string; ruleRef: string; title: string; geometry: string; input: RuleInput; expected: string; unit: string;
  handSteps: string[]; purpose: string;
};

export const REFERENCE_CASES: ReferenceCase[] = [
  {
    id: "RC-C1", ruleRef: "sys:concrete.prism@1", title: "پی گسترده با دو چاله", unit: "مترمکعب",
    geometry: "پی ۱۲٫۵ × ۸٫۲ متر به ضخامت ۰٫۶ متر؛ دو چاله ۰٫۴ × ۰٫۴ × ۰٫۶ متر داخل پی",
    input: { values: { length: "12.5", width: "8.2", height: "0.6", count: "1" }, lists: { voids: [{ v_length: "0.4", v_width: "0.4", v_height: "0.6", v_count: "2" }] } },
    expected: "61.3080", handSteps: ["12.5 × 8.2 × 0.6 × 1 = 61.5", "0.4 × 0.4 × 0.6 × 2 = 0.192", "61.5 − 0.192 = 61.308"],
    purpose: "ضرب ابعاد و کسر صریح",
  },
  {
    id: "RC-C2", ruleRef: "sys:concrete.prism@1", title: "شش پی منفرد یکسان", unit: "مترمکعب",
    geometry: "شش پی ۲٫۴ × ۲٫۴ متر به ارتفاع ۰٫۵۵ متر، بدون فضای خالی",
    input: { values: { length: "2.4", width: "2.4", height: "0.55", count: "6" }, lists: { voids: [] } },
    expected: "19.0080", handSteps: ["2.4 × 2.4 × 0.55 = 3.168", "3.168 × 6 = 19.008"], purpose: "تکرار المان",
  },
  {
    id: "RC-C3", ruleRef: "sys:concrete.cylinder@1", title: "چهار شمع دایره‌ای", unit: "مترمکعب",
    geometry: "چهار شمع به قطر ۰٫۸ متر و طول ۱۲ متر",
    input: { values: { diameter: "0.8", height: "12", count: "4" } },
    expected: "24.1274", handSteps: ["π × 0.8² ÷ 4 = 0.16π = 0.50265482…", "0.50265482… × 12 × 4 = 24.12743158…", "گرد کردن به ۴ رقم: 24.1274"],
    purpose: "عدد π و گرد کردن عدد گنگ",
  },
  {
    id: "RC-C4", ruleRef: "sys:concrete.slab_openings@1", title: "دال با بازشوی پله و دو داکت", unit: "مترمکعب",
    geometry: "دال ۱۰ × ۶٫۵ متر به ضخامت ۰٫۲ متر؛ بازشوی ۱٫۲ × ۲٫۴ و دو داکت ۰٫۶ × ۰٫۶ متر",
    input: { values: { length: "10", width: "6.5", thickness: "0.2" }, lists: { openings: [{ o_length: "1.2", o_width: "2.4", o_count: "1" }, { o_length: "0.6", o_width: "0.6", o_count: "2" }] } },
    expected: "12.2800", handSteps: ["10 × 6.5 = 65", "1.2 × 2.4 × 1 + 0.6 × 0.6 × 2 = 2.88 + 0.72 = 3.6", "(65 − 3.6) × 0.2 = 12.28"],
    purpose: "جمع فهرست بازشوها",
  },
  {
    id: "RC-F1", ruleRef: "sys:formwork.footing_sides@1", title: "قالب جانبی پنج پی", unit: "مترمربع",
    geometry: "پنج پی ۲٫۴ × ۱٫۸ متر به ارتفاع ۰٫۶ متر",
    input: { values: { length: "2.4", width: "1.8", height: "0.6", count: "5" } },
    expected: "25.2000", handSteps: ["2 × (2.4 + 1.8) = 8.4", "8.4 × 0.6 × 5 = 25.2"], purpose: "محیط × ارتفاع",
  },
  {
    id: "RC-F2", ruleRef: "sys:formwork.column_rect@1", title: "قالب دوازده ستون", unit: "مترمربع",
    geometry: "دوازده ستون ۰٫۴۵ × ۰٫۵ متر با ارتفاع قالب‌بندی ۳٫۲ متر",
    input: { values: { side_a: "0.45", side_b: "0.5", height: "3.2", count: "12" } },
    expected: "72.9600", handSteps: ["2 × (0.45 + 0.5) = 1.9", "1.9 × 3.2 × 12 = 72.96"], purpose: "محیط مقطع × ارتفاع × تعداد",
  },
  {
    id: "RC-F3", ruleRef: "sys:formwork.beam_drop@1", title: "قالب سه تیر آویز", unit: "مترمربع",
    geometry: "سه تیر ۰٫۴ × ۰٫۶ متر زیر دال ۰٫۲ متری با طول آزاد ۵٫۶ متر",
    input: { values: { beam_width: "0.4", beam_depth: "0.6", slab_thickness: "0.2", length: "5.6", count: "3" } },
    expected: "20.1600", handSteps: ["0.6 − 0.2 = 0.4", "0.4 + 2 × 0.4 = 1.2", "1.2 × 5.6 × 3 = 20.16"], purpose: "کسر ضخامت دال از گونه تیر",
  },
  {
    id: "RC-F4", ruleRef: "sys:formwork.wall_faces@1", title: "قالب دوطرفه دیوار با یک بازشو", unit: "مترمربع",
    geometry: "دیوار ۸ × ۳ متر، دو وجه، یک بازشوی ۱ × ۲٫۱ متر",
    input: { values: { length: "8", height: "3", faces: "2", count: "1" }, lists: { openings: [{ o_width: "1", o_height: "2.1", o_count: "1" }] } },
    expected: "43.8000", handSteps: ["8 × 3 = 24", "24 − 1 × 2.1 = 21.9", "21.9 × 2 × 1 = 43.8"], purpose: "کسر بازشو از هر وجه",
  },
  {
    id: "RC-R1", ruleRef: "sys:rebar.mass_from_unit_mass@1", title: "لیستوفر با جرم واحد جدول", unit: "کیلوگرم",
    geometry: "۲۴ قطعه ۶٫۴ متری با جرم واحد ۱٫۵۸ و ۶۰ قطعه ۱٫۸۵ متری با جرم واحد ۰٫۶۱۷ کیلوگرم بر متر (مقادیر ورودی مثال)",
    input: { lists: { bars: [{ bar_length: "6.4", bar_count: "24", unit_mass: "1.58" }, { bar_length: "1.85", bar_count: "60", unit_mass: "0.617" }] } },
    expected: "311.1750", handSteps: ["6.4 × 24 × 1.58 = 242.688", "1.85 × 60 × 0.617 = 68.487", "242.688 + 68.487 = 311.175"], purpose: "جمع وزنی ردیف‌های لیستوفر",
  },
  {
    id: "RC-R2", ruleRef: "sys:rebar.mass_theoretical@1", title: "جرم نظری دو قطر میلگرد", unit: "کیلوگرم",
    geometry: "۱۰ شاخه ۱۲ متری قطر ۱۶ و ۴۰ قطعه ۲٫۵ متری قطر ۱۰ میلی‌متر؛ چگالی ورودی مثال ۷۸۵۰ کیلوگرم بر مترمکعب",
    input: { values: { density: "7850" }, lists: { bars: [{ diameter_mm: "16", bar_length: "12", bar_count: "10" }, { diameter_mm: "10", bar_length: "2.5", bar_count: "40" }] } },
    expected: "251.0541",
    handSteps: ["π × 0.016² ÷ 4 × 7850 = 1.57833615… kg/m", "1.57833615… × 12 × 10 = 189.40033790…", "π × 0.010² ÷ 4 × 7850 = 0.61653756… kg/m", "0.61653756… × 2.5 × 40 = 61.65375583…", "189.40033790… + 61.65375583… = 251.05409373… → 251.0541"],
    purpose: "تبدیل میلی‌متر به متر، π و گرد کردن",
  },
  {
    id: "RC-E1", ruleRef: "sys:earthwork.box@1", title: "گود با دیواره قائم", unit: "مترمکعب",
    geometry: "گود ۱۸ × ۱۲ متر به عمق ۳٫۲ متر",
    input: { values: { length: "18", width: "12", depth: "3.2" } },
    expected: "691.2000", handSteps: ["18 × 12 × 3.2 = 691.2"], purpose: "حجم مکعب‌مستطیل",
  },
  {
    id: "RC-E2", ruleRef: "sys:earthwork.prismoid_pit@1", title: "گود با دیواره شیب‌دار", unit: "مترمکعب",
    geometry: "کف ۱۰ × ۶ متر، عمق ۳ متر، شیب دیواره ۰٫۵ افقی به ۱ قائم",
    input: { values: { bottom_length: "10", bottom_width: "6", depth: "3", slope: "0.5" } },
    expected: "261.0000",
    handSteps: ["دهانه بالا: 10 + 2 × 0.5 × 3 = 13 و 6 + 3 = 9", "سطح کف 60، سطح میانی 11.5 × 7.5 = 86.25، سطح بالا 117", "3 ÷ 6 × (60 + 4 × 86.25 + 117) = 0.5 × 522 = 261", "کنترل با رابطه بسته: 3 × (60 + 0.5 × 3 × 16 + 4/3 × 0.25 × 9) = 3 × 87 = 261"],
    purpose: "رابطه منشورگون و کنترل با رابطه بسته",
  },
  {
    id: "RC-E3", ruleRef: "sys:earthwork.trench_trapezoid@1", title: "ترانشه ذوزنقه‌ای", unit: "مترمکعب",
    geometry: "عرض کف ۰٫۸، عرض بالا ۱٫۶، عمق ۱٫۵ و طول ۴۲ متر",
    input: { values: { bottom_width: "0.8", top_width: "1.6", depth: "1.5", length: "42" } },
    expected: "75.6000", handSteps: ["(0.8 + 1.6) ÷ 2 × 1.5 = 1.8", "1.8 × 42 = 75.6"], purpose: "سطح ذوزنقه × طول",
  },
  {
    id: "RC-M1", ruleRef: "sys:masonry.wall_area_net@1", title: "دو دیوار مشابه با در و پنجره", unit: "مترمربع",
    geometry: "دو دیوار ۷٫۳۵ × ۲٫۹ متر؛ دو در ۰٫۹ × ۲٫۱ و یک پنجره ۱٫۵ × ۱٫۲ متر",
    input: { values: { length: "7.35", height: "2.9", count: "2" }, lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "2" }, { o_width: "1.5", o_height: "1.2", o_count: "1" }] } },
    expected: "37.0500", handSteps: ["7.35 × 2.9 × 2 = 42.63", "0.9 × 2.1 × 2 + 1.5 × 1.2 × 1 = 3.78 + 1.8 = 5.58", "42.63 − 5.58 = 37.05"], purpose: "کسر بازشوهای متعدد",
  },
  {
    id: "RC-M2", ruleRef: "sys:masonry.wall_volume_net@1", title: "حجم دیوار ۲۲ سانتی با یک در", unit: "مترمکعب",
    geometry: "دیوار ۵٫۲ × ۳ متر به ضخامت ۰٫۲۲ متر با یک در ۱ × ۲٫۲ متر",
    input: { values: { length: "5.2", height: "3", thickness: "0.22" }, lists: { openings: [{ o_width: "1", o_height: "2.2", o_count: "1" }] } },
    expected: "2.9480", handSteps: ["5.2 × 3 = 15.6", "15.6 − 2.2 = 13.4", "13.4 × 0.22 = 2.948"], purpose: "سطح خالص × ضخامت",
  },
  {
    id: "RC-D1", ruleRef: "sys:concrete.prism@2", title: "آستانه حفره ۰٫۰۵ مترمکعب (پیش‌نویس)", unit: "مترمکعب",
    geometry: "عضو ۶ × ۵ × ۰٫۲ متر؛ دو حفره ۰٫۰۴، یک حفره ۰٫۲۲ و یک حفره دقیقاً ۰٫۰۵ مترمکعبی",
    input: { values: { length: "6", width: "5", height: "0.2", count: "1" }, lists: { voids: [
      { v_length: "0.4", v_width: "0.5", v_height: "0.2", v_count: "2" }, { v_length: "1", v_width: "1.1", v_height: "0.2", v_count: "1" },
      { v_length: "0.5", v_width: "0.5", v_height: "0.2", v_count: "1" }] } },
    expected: "5.7800",
    handSteps: ["6 × 5 × 0.2 = 6", "0.4 × 0.5 × 0.2 = 0.04 ≤ 0.05 → کسر نمی‌شود", "1 × 1.1 × 0.2 = 0.22 > 0.05 → کسر می‌شود", "0.5 × 0.5 × 0.2 = 0.05 ≤ 0.05 → کسر نمی‌شود (حالت مرزی)", "6 − 0.22 = 5.78"],
    purpose: "شرط آستانه و حالت مرزی «مساوی»",
  },
  {
    id: "RC-D2", ruleRef: "sys:formwork.wall_faces@2", title: "قالب یکسره در محل بازشو (پیش‌نویس)", unit: "مترمربع",
    geometry: "دیوار ۸ × ۳ متر، دو وجه، بازشوی ۱ × ۲٫۱ متر؛ قالب در محل بازشو یکسره و غیرقابل قطع",
    input: { values: { length: "8", height: "3", faces: "2", count: "1", continuous: "1" }, lists: { openings: [{ o_width: "1", o_height: "2.1", o_count: "1" }] } },
    expected: "48.0000", handSteps: ["8 × 3 = 24", "قالب یکسره → سطح بازشو کسر نمی‌شود", "24 × 2 × 1 = 48"], purpose: "اثر شرط اجرایی بر کسر",
  },
  {
    id: "RC-D3", ruleRef: "sys:masonry.wall_area_net@2", title: "آستانه سوراخ ۰٫۰۵ مترمربع (پیش‌نویس)", unit: "مترمربع",
    geometry: "دیوار ۴ × ۳ متر؛ سه سوراخ ۰٫۲ × ۰٫۲، یک سوراخ ۰٫۲۵ × ۰٫۲ و یک پنجره ۱٫۲ × ۱٫۵ متر",
    input: { values: { length: "4", height: "3", count: "1" }, lists: { openings: [
      { o_width: "0.2", o_height: "0.2", o_count: "3" }, { o_width: "0.25", o_height: "0.2", o_count: "1" }, { o_width: "1.2", o_height: "1.5", o_count: "1" }] } },
    expected: "10.1500",
    handSteps: ["4 × 3 × 1 = 12", "0.2 × 0.2 = 0.04 < 0.05 → کسر نمی‌شود", "0.25 × 0.2 = 0.05 که «کمتر از» ۰٫۰۵ نیست → کسر می‌شود (حالت مرزی)", "1.2 × 1.5 = 1.8 → کسر می‌شود", "12 − 0.05 − 1.8 = 10.15"],
    purpose: "شرط آستانه اکید و حالت مرزی",
  },
  {
    id: "RC-PL1", ruleRef: "sys:plaster.wall_face_area@1", title: "اندود دو دیوار مشابه با در و پنجره", unit: "مترمربع",
    geometry: "دو دیوار ۵٫۲ × ۲٫۹ متر؛ دو در ۰٫۹ × ۲٫۱ و یک پنجره ۱٫۵ × ۱٫۲ متر",
    input: { values: { length: "5.2", height: "2.9", count: "2" }, lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "2" }, { o_width: "1.5", o_height: "1.2", o_count: "1" }] } },
    expected: "24.5800", handSteps: ["5.2 × 2.9 × 2 = 30.16", "0.9 × 2.1 × 2 + 1.5 × 1.2 = 5.58", "30.16 − 5.58 = 24.58"], purpose: "کسر بازشو در اندود وجه دیوار",
  },
  {
    id: "RC-PL2", ruleRef: "sys:plaster.ceiling_area@1", title: "اندود سقف با دو داکت و یک بازشو", unit: "مترمربع",
    geometry: "سقف ۶٫۴ × ۳٫۸ متر؛ دو داکت ۰٫۶ × ۰٫۶ و یک بازشوی ۱٫۲ × ۱٫۲ متر",
    input: { values: { length: "6.4", width: "3.8" }, lists: { openings: [{ o_length: "0.6", o_width: "0.6", o_count: "2" }, { o_length: "1.2", o_width: "1.2", o_count: "1" }] } },
    expected: "22.1600", handSteps: ["6.4 × 3.8 = 24.32", "0.6 × 0.6 × 2 + 1.2 × 1.2 = 2.16", "24.32 − 2.16 = 22.16"], purpose: "کسر بازشوی سقف",
  },
  {
    id: "RC-PL3", ruleRef: "sys:plaster.mortar_volume@1", title: "حجم ملات اندود دیوار با یک در", unit: "مترمکعب",
    geometry: "سطح ۱۰ × ۳ متر با یک در ۱ × ۲ متر و ضخامت اندود ۲ سانتی‌متر",
    input: { values: { length: "10", height: "3", thickness: "0.02" }, lists: { openings: [{ o_width: "1", o_height: "2", o_count: "1" }] } },
    expected: "0.5600", handSteps: ["10 × 3 = 30", "30 − 2 = 28", "28 × 0.02 = 0.56"], purpose: "سطح خالص × ضخامت اندود",
  },
  {
    id: "RC-FL1", ruleRef: "sys:floor.screed_volume@1", title: "زیرسازی کف یک فضا", unit: "مترمکعب",
    geometry: "کف ۱۲٫۵ × ۸٫۴ متر با ضخامت زیرسازی ۷ سانتی‌متر",
    input: { values: { length: "12.5", width: "8.4", thickness: "0.07", count: "1" } },
    expected: "7.3500", handSteps: ["12.5 × 8.4 × 0.07 = 7.35"], purpose: "حجم زیرسازی",
  },
  {
    id: "RC-FL2", ruleRef: "sys:floor.finish_area@1", title: "کف‌سازی نهایی سه بازشو دار", unit: "مترمربع",
    geometry: "کف ۹٫۶ × ۵٫۴ متر با سه بازشوی ۰٫۸ × ۰٫۸ متر",
    input: { values: { length: "9.6", width: "5.4" }, lists: { openings: [{ o_length: "0.8", o_width: "0.8", o_count: "3" }] } },
    expected: "49.9200", handSteps: ["9.6 × 5.4 = 51.84", "0.8 × 0.8 × 3 = 1.92", "51.84 − 1.92 = 49.92"], purpose: "کسر بازشوی کف",
  },
  {
    id: "RC-FL3", ruleRef: "sys:floor.skirting_length@1", title: "قرنیز سه فضای مشابه", unit: "متر",
    geometry: "سه فضا ۴٫۸ × ۳٫۶ متر؛ دو بازشوی ۰٫۹ متری در مسیر قرنیز",
    input: { values: { length: "4.8", width: "3.6", count: "3" }, lists: { openings: [{ o_width: "0.9", o_count: "2" }] } },
    expected: "48.6000", handSteps: ["2 × (4.8 + 3.6) × 3 = 50.4", "0.9 × 2 = 1.8", "50.4 − 1.8 = 48.6"], purpose: "محیط منهای عرض بازشوها",
  },
  {
    id: "RC-IN1", ruleRef: "sys:insulation.membrane_area@1", title: "عایق کرسی با لبه عمودی", unit: "مترمربع",
    geometry: "سطح افقی ۸ × ۵ متر؛ لبه عمودی به طول کل ۲۶ متر و ارتفاع ۰٫۳ متر",
    input: { values: { length: "8", width: "5", upturn_length: "26", upturn_height: "0.3" } },
    expected: "47.8000", handSteps: ["8 × 5 = 40", "26 × 0.3 = 7.8", "40 + 7.8 = 47.8"], purpose: "سطح افقی به‌علاوه لبه عمودی",
  },
  {
    id: "RC-IN2", ruleRef: "sys:insulation.board_area@1", title: "عایق صفحه‌ای دیوارها", unit: "مترمربع",
    geometry: "یک دیوار ۱۲ × ۳ متر و دو دیوار ۶٫۵ × ۳ متر",
    input: { lists: { surfaces: [{ s_length: "12", s_height: "3", s_count: "1" }, { s_length: "6.5", s_height: "3", s_count: "2" }] } },
    expected: "75.0000", handSteps: ["12 × 3 × 1 = 36", "6.5 × 3 × 2 = 39", "36 + 39 = 75"], purpose: "جمع سطوح فهرستی",
  },
  {
    id: "RC-ST1", ruleRef: "sys:steel.member_mass@1", title: "جرم دو ردیف پروفیل", unit: "کیلوگرم",
    geometry: "شش قطعه ۴٫۲ متری با جرم واحد ۴۲٫۶ و چهارده قطعه ۲٫۸ متری با جرم واحد ۲۴٫۲ کیلوگرم بر متر (مقادیر ورودی مثال)",
    input: { lists: { members: [{ m_length: "4.2", m_count: "6", unit_mass: "42.6" }, { m_length: "2.8", m_count: "14", unit_mass: "24.2" }] } },
    expected: "2022.1600", handSteps: ["4.2 × 6 × 42.6 = 1073.52", "2.8 × 14 × 24.2 = 948.64", "1073.52 + 948.64 = 2022.16"], purpose: "جمع جرمی پروفیل‌ها",
  },
  {
    id: "RC-ST2", ruleRef: "sys:steel.plate_mass@1", title: "جرم یک ورق", unit: "کیلوگرم",
    geometry: "ورق ۲ × ۱ متر به ضخامت ۱۰ میلی‌متر؛ چگالی ورودی مثال ۷۸۵۰ کیلوگرم بر مترمکعب",
    input: { values: { length: "2", width: "1", thickness_mm: "10", density: "7850", count: "1" } },
    expected: "157.0000", handSteps: ["10 ÷ 1000 = 0.01 متر", "2 × 1 × 0.01 × 1 = 0.02 مترمکعب", "0.02 × 7850 = 157"], purpose: "تبدیل میلی‌متر به متر و چگالی",
  },
  {
    id: "RC-ST3", ruleRef: "sys:steel.section_paint_area@1", title: "سطح رنگ ده ستون فولادی", unit: "مترمربع",
    geometry: "ده عضو با محیط مقطع ۱٫۲۴ متر و طول ۶ متر",
    input: { values: { section_perimeter: "1.24", length: "6", count: "10" } },
    expected: "74.4000", handSteps: ["1.24 × 6 × 10 = 74.4"], purpose: "محیط مقطع × طول × تعداد",
  },
  {
    id: "RC-ST4", ruleRef: "sys:steel.connection_mass@1", title: "جرم صفحات اتصال دو نوع", unit: "کیلوگرم",
    geometry: "هشت صفحه ۰٫۳ × ۰٫۲۵ × ۱۲ میلی‌متر و چهار صفحه ۰٫۲ × ۰٫۱۵ × ۸ میلی‌متر؛ چگالی ورودی مثال ۷۸۵۰ کیلوگرم بر مترمکعب",
    input: { values: { density: "7850" }, lists: { plates: [{ p_length: "0.3", p_width: "0.25", p_thickness_mm: "12", p_count: "8" }, { p_length: "0.2", p_width: "0.15", p_thickness_mm: "8", p_count: "4" }] } },
    expected: "64.0560",
    handSteps: ["0.3 × 0.25 × 0.012 × 8 = 0.0072 مترمکعب", "0.2 × 0.15 × 0.008 × 4 = 0.00096 مترمکعب", "0.0072 + 0.00096 = 0.00816", "0.00816 × 7850 = 64.056"], purpose: "تبدیل ضخامت و جمع حجمی صفحات",
  },
];
