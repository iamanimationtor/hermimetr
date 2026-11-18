/**
 * Register of official documents that govern measurement and estimating, as IDENTIFIED during development.
 *
 * Nothing in this file is verified. The official portals could not be reached from the development environment,
 * so metadata was only cross-read on intermediary websites. Every entry therefore carries the status "unverified"
 * and is offered to the user as a starting point for their own verification in the reference library.
 */
export type OfficialDocument = {
  key: string; title: string; kind: "pricebook" | "regulation" | "technical" | "contract" | "adjustment" | "other";
  issuer: string; documentNumber: string | null; issueDate: string | null; effectiveDate: string | null; basePeriod: string | null;
  scope: string; portalName: string; portalUrl: string | null; status: "unverified";
  identifiedFrom: string; verificationAttempt: string; relevance: string;
  /** Dated reports read on intermediary sites. Recorded as evidence only; none of them is a confirmation. */
  reports?: string[];
};

const ATTEMPT = "آبان ۱۴۰۵ (نوامبر ۲۰۲۶): نام دامنه درگاه رسمی در دسترس بود اما اتصال TCP برقرار نشد (احتمالاً محدودیت دسترسی جغرافیایی). درخواست از هر دو مسیر ابزار پژوهش و محیط اجرای برنامه و همچنین با شناسه مرورگر ارسال شد و همه ناموفق بودند؛ بنابراین متن، شماره بند و شماره صفحه سند رسمی قابل تطبیق نیست.";
const SAME_AS_1404 = "چند منبع واسط (اردیبهشت تا شهریور ۱۴۰۵) نوشته‌اند فهرست ۱۴۰۵ ابلاغ نشده و فهرست ۱۴۰۴ با ضرایب اصلاحی مبنا می‌ماند؛ یک منبع (مهر ۱۴۰۵، بخش پرسش‌وپاسخ) خلاف آن را ادعا کرده است. این تناقض تا کنترل درگاه رسمی حل‌نشده باقی می‌ماند.";
const MPORG = { portalName: "سامانه ضوابط نظام فنی و اجرایی (سازمان برنامه و بودجه کشور)", portalUrl: "https://sama.mporg.ir/" };

export const OFFICIAL_REGISTER: OfficialDocument[] = [
  {
    key: "abnieh-1404", title: "فهرست‌بهای واحد پایه رشته ابنیه سال ۱۴۰۴", kind: "pricebook", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: "1403/742948", issueDate: "1403/12/29", effectiveDate: "1404/01/01", basePeriod: "1404",
    scope: "طبق متن بخشنامه در نسخه‌های غیررسمی: برآورد هزینه کارهایی که تمام یا بخشی از تأمین مالی آن‌ها از وجوه عمومی است و ارجاع کارشان از ابتدای ۱۴۰۴ آغاز می‌شود.",
    ...MPORG, status: "unverified",
    identifiedFrom: "شماره و تاریخ در سه منبع واسط یکسان دیده شد (omoorepeyman.ir، shaghool.ir و یک نسخه PDF غیررسمی).",
    verificationAttempt: ATTEMPT,
    relevance: "مبنای ضوابط اندازه‌گیری فصل‌ها (بتن درجا، قالب‌بندی، میلگرد، آجرکاری) و بانک ردیف‌های رسمی.",
  },
  {
    key: "abnieh-1405", title: "فهرست‌بهای واحد پایه رشته ابنیه سال ۱۴۰۵", kind: "pricebook", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: null, issueDate: null, effectiveDate: null, basePeriod: "1405",
    scope: "نامشخص. چند منبع واسط (مرداد تا شهریور ۱۴۰۵) نوشته‌اند این فهرست هنوز ابلاغ نشده و فهرست ۱۴۰۴ مبنا مانده است.",
    ...MPORG, status: "unverified",
    identifiedFrom: "گزارش منابع واسط (civilhouse.ir مرداد ۱۴۰۵، academyofcivil.com اردیبهشت ۱۴۰۵، modiremetre.ir اردیبهشت ۱۴۰۵، karanzaadeh.com شهریور ۱۴۰۵)؛ اطلاعیه رسمی دیده نشد.",
    verificationAttempt: ATTEMPT,
    reports: ["مرداد ۱۴۰۵: «اطلاعیه رسمی و قطعی مبنی بر ابلاغ فهرست ابنیه ۱۴۰۵ منتشر نشده و فهرست ۱۴۰۴ آخرین مرجع لازم‌الاجرا است» (civilhouse.ir).",
      "اردیبهشت ۱۴۰۵: «فهرست ابنیه ۱۴۰۵ تدوین و منتشر نخواهد شد و ۱۴۰۴ با ضرایب اصلاحی مبنا می‌ماند» (academyofcivil.com و modiremetre.ir).",
      "مهر ۱۴۰۵: در بخش پرسش‌وپاسخ یک سایت واسط ادعا شده انتشار رسمی انجام شده است؛ این ادعا با بقیه منابع ناسازگار و بدون شماره بخشنامه است."],
    relevance: "پیش از هر برآورد رسمی باید وضعیت ابلاغ این فهرست یا ضرایب جایگزین در درگاه رسمی کنترل شود. تا آن زمان هیچ نسخه‌ای از آن در سامانه وارد نشده است.",
  },
  {
    key: "tajzieh-baha-1396", title: "دستورالعمل نحوه ارائه تجزیه‌بها همراه با پیشنهاد قیمت توسط پیمانکاران", kind: "other",
    issuer: "سازمان برنامه و بودجه کشور", documentNumber: "96/1232579", issueDate: "1396/03/31", effectiveDate: null, basePeriod: null,
    scope: "طبق منابع واسط: کارهای با برآورد برابر یا بیشتر از نصاب تعیین‌شده؛ جایگزین بخشنامه ۴۹۵۱/۵۴ مورخ ۱۳۷۷/۰۹/۰۹.",
    ...MPORG, status: "unverified",
    identifiedFrom: "شماره و تاریخ در چند منبع واسط یکسان دیده شد (shenasname.ir، haftshahraria.com، modiremetre.ir).",
    verificationAttempt: ATTEMPT, relevance: "مبنای ساختار تجزیه‌بها (مرحله بعدی توسعه).",
  },
  {
    key: "star-items", title: "دستورالعمل نحوه تهیه و تصویب ردیف‌های ستاره‌دار (غیرپایه)", kind: "other", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: null, issueDate: null, effectiveDate: null, basePeriod: null,
    scope: "نامشخص. در یک منبع واسط با شماره ۳۴۰۰۱ از آن یاد شده؛ شماره کامل و تاریخ تأیید نشد.",
    ...MPORG, status: "unverified", identifiedFrom: "یک منبع واسط (industrial-shed.com).",
    verificationAttempt: ATTEMPT, relevance: "قیمت‌گذاری ردیف‌های غیرپایه و آنالیز قیمت جدید (مرحله بعدی توسعه).",
  },
  {
    key: "tadil-1385", title: "دستورالعمل نحوه تعدیل آحاد بهای پیمان‌ها", kind: "adjustment", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: "101/173073", issueDate: "1385/09/15", effectiveDate: null, basePeriod: null,
    scope: "نامشخص؛ شمول باید با شرایط پیمان و اصلاحیه‌های بعدی کنترل شود.",
    ...MPORG, status: "unverified", identifiedFrom: "شماره و تاریخ فقط در یک منبع واسط (وبلاگ) دیده شد.",
    verificationAttempt: ATTEMPT, relevance: "موتور تعدیل (هنوز پیاده‌سازی نشده است).",
  },
  {
    key: "nashrieh-55", title: "مشخصات فنی عمومی کارهای ساختمانی (ضابطه شماره ۵۵)", kind: "technical", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: "55", issueDate: null, effectiveDate: null, basePeriod: null,
    scope: "نامشخص؛ ویرایش معتبر و تاریخ ابلاغ آن تأیید نشد.",
    ...MPORG, status: "unverified", identifiedFrom: "ارجاع در متن فهرست‌بهای ابنیه (نسخه غیررسمی) و شرح مأموریت پروژه.",
    verificationAttempt: ATTEMPT, relevance: "تعاریف و مشخصات فنی که ردیف‌های فهرست‌بها به آن ارجاع می‌دهند.",
  },
  {
    key: "inso-3132", title: "استاندارد ملی ایران شماره ۳۱۳۲: میلگردهای فولادی گرم‌نوردیده برای تسلیح بتن", kind: "technical",
    issuer: "سازمان ملی استاندارد ایران", documentNumber: "3132", issueDate: null, effectiveDate: null, basePeriod: null,
    scope: "نامشخص؛ ویرایش معتبر تأیید نشد.",
    portalName: "درگاه سازمان ملی استاندارد ایران (نشانی باید توسط کاربر کنترل شود)", portalUrl: null, status: "unverified",
    identifiedFrom: "ارجاع فصل هفتم فهرست‌بهای ابنیه طبق یک منبع واسط.",
    verificationAttempt: "آبان ۱۴۰۵: متن استاندارد دریافت نشد.",
    relevance: "جرم واحد طول و رواداری‌های میلگرد در قواعد آرماتوربندی.",
  },
  {
    key: "mabhas-9", title: "مقررات ملی ساختمان، مبحث نهم: طرح و اجرای ساختمان‌های بتن‌آرمه", kind: "regulation",
    issuer: "وزارت راه و شهرسازی، دفتر مقررات ملی و کنترل ساختمان", documentNumber: null, issueDate: null, effectiveDate: null, basePeriod: "ویرایش ۱۳۹۹ (طبق فهرست صفحه دفتر)",
    scope: "نامشخص؛ آخرین ویرایش و اصلاحیه‌ها باید در درگاه دفتر کنترل شود.",
    portalName: "دفتر مقررات ملی و کنترل ساختمان", portalUrl: "https://inbr.ir/", status: "unverified",
    identifiedFrom: "عنوان و سال ویرایش در نتیجه جست‌وجوی صفحه‌های inbr.ir دیده شد.",
    verificationAttempt: "آبان ۱۴۰۵: درگاه inbr.ir از محیط توسعه پاسخ نداد.",
    relevance: "ضوابط فنی اعضای بتنی (پوشش، وصله، قلاب) که بر طول برش میلگرد اثر دارد.",
  },
  {
    key: "sharayet-omumi", title: "شرایط عمومی پیمان (نشریه ۴۳۱۱)", kind: "contract", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: "4311", issueDate: null, effectiveDate: null, basePeriod: null,
    scope: "نامشخص؛ شمول تابع نوع پیمان است.",
    ...MPORG, status: "unverified", identifiedFrom: "شرح مأموریت پروژه.",
    verificationAttempt: ATTEMPT, relevance: "قیمت جدید، تغییر مقادیر و صورت‌وضعیت (مراحل بعدی توسعه).",
  },
  {
    key: "abnieh-1405-coefficients", title: "ضرایب اصلاحی فهرست‌بهای ابنیه برای سال ۱۴۰۵", kind: "adjustment", issuer: "سازمان برنامه و بودجه کشور",
    documentNumber: null, issueDate: null, effectiveDate: null, basePeriod: "1404 (مبنا) / 1405 (اعمال)",
    scope: "نامشخص. طبق منابع واسط، در صورت عدم انتشار فهرست ۱۴۰۵، ضرایبی بر مبنای متوسط تغییرات مصالح، دستمزد و تجهیزات نسبت به ۱۴۰۴ ابلاغ می‌شود.",
    ...MPORG, status: "unverified",
    identifiedFrom: "گزارش چند منبع واسط (اردیبهشت تا مرداد ۱۴۰۵). شماره بخشنامه، مقدار ضرایب و تاریخ ابلاغ در هیچ منبع معتبری دیده نشد.",
    verificationAttempt: ATTEMPT,
    reports: [SAME_AS_1404, "هیچ عدد یا ضریبی از این سند در هیچ منبع معتبری دیده نشد و در نتیجه هیچ مقداری در سامانه ثبت نشده است."],
    relevance: "در صورت ابلاغ، مبنای تعدیل یا اصلاح آحاد بهای پروژه‌هایی که فهرست ۱۴۰۴ مبنای آن‌هاست خواهد بود.",
  },
];
