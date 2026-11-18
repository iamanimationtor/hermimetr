"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import { RuleCalculator, RuleTraceView, RulesView } from "@/components/rules-view";
import { MatchDialog, PricebookView, type PricebookEdition } from "@/components/pricebook-view";
import type { NormalizedInputs, ReviewInfo, RuleBankEntry, TraceStep } from "@/lib/rules/engine";
import type { OfficialDocument } from "@/lib/rules/official-register";
import {
  Activity, Archive, ArrowLeft, ArrowUpLeft, BadgeCheck, BookOpen, Building2, Calculator, Check,
  CheckCircle2, ChevronDown, ChevronLeft, CircleHelp, ClipboardList, Clock3, Copy, Download,
  ExternalLink, Eye, FileSpreadsheet, FileText, Files, Filter, HardHat, Info, Layers3, LayoutDashboard,
  Link2, ListChecks, LockKeyhole, MapPin, Menu, Moon, MoreHorizontal, Pencil, Plus, Printer, Ruler, Search, ShieldAlert, ShieldCheck,
  Sigma, SlidersHorizontal, Sparkles, Sun, Tags, Trash2, UploadCloud, UserRound, X, type LucideIcon,
} from "lucide-react";
import { calculateQuantity, measurementUnits, type EstimateLine, type MeasurementKind, type PricingBasis } from "@/lib/calculations";
import { MAX_DOCUMENT_BYTES } from "@/lib/limits";
import { previewToken, sessionFetch, setPreviewToken } from "@/lib/client-session";
import { FallbackDocument, FallbackReport } from "@/components/preview-fallback";
import { CoefficientScenarioModal } from "@/components/coefficient-scenario";
import { ProgressView } from "@/components/progress-view";
import { ReadinessPanel } from "@/components/readiness-panel";
import { readCoefficientScenario } from "@/lib/coefficient-scenario";
import type { ValidityLite } from "@/lib/readiness";

type Project = { id: string; name: string; code: string | null; type: string; province: string | null; city: string | null;
  area: string | null; floors: number; basements: number; structure: string | null; foundation: string | null;
  employer: string | null; contractor: string | null; contractType: string | null; fundingType: string; pricingBasis: string;
  contractReference: string | null; estimateDate: string | null; stage: string; status: string; notes: string | null;
  isDemo: boolean; createdAt: string; updatedAt: string };
type Takeoff = { id: string; projectId: string; title: string; category: string; floor: string | null; location: string | null;
  kind: MeasurementKind; unit: string; length: string | null; width: string | null; height: string | null;
  count: string; unitWeight: string | null; deduction: string; quantity: string; formula: string;
  sourceNote: string | null; ruleReference: string | null; documentId: string | null; priceId: string | null;
  status: string; isDemo: boolean; createdAt: string;
  ruleRef: string | null; ruleKey: string | null; ruleVersion: number | null; ruleTrace: TraceStep[] | null; ruleInputs: NormalizedInputs | null;
  certainty: string | null; pricebookItemId: string | null; duplicateNote: string | null };
type Price = { id: string; title: string; code: string | null; category: string | null; unit: string; basis: string;
  amount: string; currency: string; sourceName: string; sourceUrl: string | null; supplier: string | null;
  region: string | null; priceDate: string; validUntil: string | null; referenceId: string | null; pricebookItemId: string | null; confirmed: boolean; createdAt: string };
type Reference = { id: string; title: string; kind: string; issuer: string; documentNumber: string | null;
  issueDate: string | null; effectiveDate: string | null; basePeriod: string | null; scope: string | null;
  amendments: string | null; replacement: string | null; status: string; url: string | null; notes: string | null; createdAt: string };
type Document = { id: string; projectId: string; fileName: string; mimeType: string; sizeBytes: number;
  version: string; description: string | null; uploadedAt: string };
type Snapshot = { id: string; projectId: string; version: number; basis: string; totalRial: string;
  rows: Record<string, unknown>[]; projectSnapshot: Record<string, unknown>; notes: string | null; createdAt: string };
type Audit = { id: string; projectId: string | null; entityType: string; action: string; createdAt: string; after: Record<string, unknown> | null };
type WorkspaceData = { user: { id: string; name: string; email: string | null; isGuest: boolean };
  projects: Project[]; takeoffs: Takeoff[]; prices: Price[]; references: Reference[];
  documents: Document[]; estimates: Snapshot[]; activity: Audit[];
  ruleBank: RuleBankEntry[]; caseReviews: Record<string, ReviewInfo>; editions: PricebookEdition[];
  rowValidity: Record<string, { state: string; label: string; reasons: string[]; action: string }> };
type Preview = { lines: EstimateLine[]; totalRial: string; issues: string[]; draftCount: number; reviewHash?: string };
type View = "dashboard" | "projects" | "takeoff" | "estimates" | "progress" | "prices" | "documents" | "references" | "reports" | "rules" | "pricebook";
type Modal = "project" | "takeoff" | "price" | "reference" | "document" | "auth" | "deleteProject" | null;
type FormState = Record<string, string | boolean>;

const navGroups: { label: string; items: { id: View; label: string; icon: LucideIcon }[] }[] = [
  { label: "فضای کاری", items: [
    { id: "dashboard", label: "داشبورد", icon: LayoutDashboard }, { id: "projects", label: "پروژه‌ها", icon: Building2 },
    { id: "takeoff", label: "متره و مقادیر", icon: Ruler }, { id: "estimates", label: "برآورد مالی", icon: Calculator },
    { id: "progress", label: "پیشرفت کار", icon: Activity },
  ] },
  { label: "داده‌ها و مستندات", items: [
    { id: "rules", label: "بانک قواعد متره", icon: Sigma }, { id: "pricebook", label: "فهرست‌بها", icon: ListChecks },
    { id: "prices", label: "بانک قیمت‌ها", icon: Tags }, { id: "documents", label: "نقشه‌ها و اسناد", icon: Files },
    { id: "references", label: "منابع مرجع", icon: BookOpen }, { id: "reports", label: "گزارش‌ها", icon: FileText },
  ] },
];
const viewLabels: Record<View, string> = { dashboard: "داشبورد", projects: "پروژه‌ها", takeoff: "متره و مقادیر",
  estimates: "برآورد مالی", progress: "پیشرفت کار", prices: "بانک قیمت‌ها", documents: "نقشه‌ها و اسناد", references: "منابع مرجع", reports: "گزارش‌ها", rules: "بانک قواعد متره", pricebook: "فهرست‌بها" };
const stageLabels: Record<string, string> = { conceptual: "مفهومی", preliminary: "مقدماتی", initial_drawings: "نقشه‌های اولیه",
  detailed: "تفصیلی", execution_drawings: "نقشه‌های اجرایی", confirmed: "مقادیر تأییدشده" };
const basisLabels: Record<string, string> = { market: "بازار آزاد", contractor: "اختصاصی پیمانکار", official: "فهرست‌بهای رسمی" };
const kindLabels: Record<string, string> = { length: "طول", area: "مساحت", volume: "حجم", count: "تعداد", weight: "وزن" };
const refLabels: Record<string, string> = { pricebook: "فهرست‌بها", regulation: "مقررات", contract: "قراردادی",
  adjustment: "تعدیل", technical: "مشخصات فنی", other: "سایر" };
const digitMap = "۰۱۲۳۴۵۶۷۸۹";
const preference = {
  get: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* optional */ } },
  remove: (key: string) => { try { localStorage.removeItem(key); } catch { /* optional */ } },
};
function fa(value: string | number | null | undefined, maxDecimals = 2) {
  const raw = String(value ?? "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return "—";
  const [whole, fraction] = raw.split(".");
  const formatted = new Intl.NumberFormat("fa-IR").format(BigInt(whole));
  const decimal = fraction?.slice(0, maxDecimals).replace(/0+$/, "");
  return decimal ? `${formatted}٫${decimal.replace(/\d/g, (d) => digitMap[Number(d)])}` : formatted;
}
function dateFa(value: string) {
  try { return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
  catch { return "—"; }
}
function Initials({ name }: { name: string }) { return <span>{name.trim().slice(0, 1) || "م"}</span>; }
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "orange" | "blue" | "red" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function PanelTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function Empty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={25} strokeWidth={1.7} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export default function Workspace() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [memoryOnlySession, setMemoryOnlySession] = useState(false);
  const sessionEstablished = useRef(false);
  const initializationStarted = useRef(false);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState("");
  const [dark, setDark] = useState(false);
  const [expert, setExpert] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("active");
  const [priceFilter, setPriceFilter] = useState("all");
  const [modal, setModal] = useState<Modal>(null);
  const [form, setForm] = useState<FormState>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [fallbackReport, setFallbackReport] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [scenarioReview, setScenarioReview] = useState<{ projectId: string; directTotal: string; reviewHash: string } | null>(null);
  const [calc, setCalc] = useState<{ ref?: string; row?: Takeoff } | null>(null);
  const [matchRow, setMatchRow] = useState<Takeoff | null>(null);

  const projects = data?.projects ?? [];
  const selected = projects.find((p) => p.id === selectedId) ?? projects.find((p) => p.status === "active") ?? projects[0];
  const currentRows = data?.takeoffs.filter((r) => r.projectId === selected?.id) ?? [];
  const currentDocs = data?.documents.filter((d) => d.projectId === selected?.id) ?? [];
  const currentSnapshots = data?.estimates.filter((s) => s.projectId === selected?.id).sort((a, b) => b.version - a.version) ?? [];
  const confirmedCount = currentRows.filter((r) => r.status === "confirmed" && !["stale", "unusable"].includes(data?.rowValidity?.[r.id]?.state ?? "")).length;
  const blockingStates = ["stale", "unusable"];
  const affectedRows = currentRows.filter((r) => blockingStates.includes(data?.rowValidity?.[r.id]?.state ?? ""));
  const outdatedRows = currentRows.filter((r) => data?.rowValidity?.[r.id]?.state === "outdated");
  const validityOf = (id: string) => data?.rowValidity?.[id];
  const readyPercent = currentRows.length ? Math.round(confirmedCount / currentRows.length * 100) : 0;
  const f = (key: string) => String(form[key] ?? "");
  const change = (key: string, value: string | boolean) => setForm((old) => ({ ...old, [key]: value }));

  async function refresh(silent = false, createGuest = false) {
    if (!silent) setLoadingError("");
    try {
      // Once established, never silently replace a lost session with a new guest workspace.
      const existingOnly = (sessionEstablished.current || !!previewToken()) && !createGuest;
      const response = await sessionFetch(existingOnly ? "/api/workspace?existing=1" : "/api/workspace", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "بارگذاری ناموفق بود.");
      let check = await sessionFetch("/api/auth/session", { cache: "no-store" });
      let session = await check.json();
      if (check.ok && session.userId !== payload.user.id) {
        const fallback = response.headers.get("x-metra-preview-session");
        if (fallback && /^[a-f0-9]{64}$/.test(fallback)) {
          const persisted = setPreviewToken(fallback);
          setMemoryOnlySession(!persisted);
          check = await sessionFetch("/api/auth/session", { cache: "no-store" });
          session = await check.json();
          if (check.ok && session.userId === payload.user.id) setToast(persisted
            ? "حالت سازگار پیش‌نمایش فعال شد؛ نشست به این برگه محدود است."
            : "ذخیره‌سازی مرورگر مسدود است؛ نشست مهمان با بارگذاری مجدد از دست می‌رود. برای حفظ پروژه‌ها حساب بسازید.");
        }
      }
      if (!check.ok || session.userId !== payload.user.id) throw new Error("نشست در دسترس نیست. اتصال یا تنظیمات مرورگر را بررسی کنید.");
      sessionEstablished.current = true;
      setData(payload as WorkspaceData);
      setLoadingError("");
      return payload as WorkspaceData;
    } catch (error) {
      const message = error instanceof Error ? error.message : "خطا در اتصال";
      setLoadingError(message);
      if (silent) setToast(message);
      return null;
    }
  }

  useEffect(() => {
    setSelectedId(preference.get("metra_project") || "");
    setDark(preference.get("metra_theme") === "dark");
    setExpert(preference.get("metra_expert") === "yes");
    const nextView = new URLSearchParams(window.location.search).get("view") as View;
    if (nextView && nextView in viewLabels) setView(nextView);
    if (!initializationStarted.current) { initializationStarted.current = true; void refresh(); }
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setModal(null); setSearchOpen(false); setGuideOpen(false); setPreviewDoc(null); setCalc(null); setMatchRow(null); }
    };
    const popHandler = () => { const next = new URLSearchParams(window.location.search).get("view") as View;
      setView(next && next in viewLabels ? next : "dashboard"); };
    const sync = () => { if (document.visibilityState === "visible" && sessionEstablished.current) void refresh(true); };
    const timer = window.setInterval(sync, 60000);
    window.addEventListener("keydown", keyHandler); window.addEventListener("popstate", popHandler);
    document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", sync); window.removeEventListener("keydown", keyHandler); window.removeEventListener("popstate", popHandler); };
  }, []);

  // Auto-update: preview recomputes on every data change + 20s poll while on estimates view (option A: never auto-fill)
  useEffect(() => {
    if (view !== "estimates" || !selected?.id || !data) return;
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      sessionFetch(`/api/estimates?projectId=${selected.id}`, { cache: "no-store" }).then((r) => r.json()).then((body) => {
        if (!cancelled) setPreview(body.issues ? body as Preview : { lines: [], totalRial: "0", issues: [body.error || "خطای برآورد"], draftCount: 0 });
      }).catch(() => { if (!cancelled) setPreview({ lines: [], totalRial: "0", issues: ["پیش‌نمایش در دسترس نیست."], draftCount: 0 }); });
    };
    setPreview(null);
    load();
    const timer = window.setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [view, selected?.id, data]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(""), 5500); return () => clearTimeout(timeout); }, [toast]);

  function navigate(next: View) {
    setView(next); setLocalSearch(""); setMobileMenu(false); setSearchOpen(false);
    window.history.pushState({}, "", next === "dashboard" ? "/" : `/?view=${next}`);
  }
  function selectProject(id: string) { setSelectedId(id); preference.set("metra_project", id); }
  function toggleTheme() { setDark((value) => { preference.set("metra_theme", value ? "light" : "dark"); return !value; }); }
  function toggleExpert() { setExpert((value) => { preference.set("metra_expert", value ? "no" : "yes"); return !value; }); }

  async function mutate(path: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const response = await sessionFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "درخواست انجام نشد.");
      const refreshed = await refresh(true, path === "/api/auth" && body.action === "logout");
      if (!refreshed) {
        setToast("عملیات ثبت شد، اما تازه‌سازی فضای کار ناموفق بود؛ پیش از تکرار عملیات اتصال یا نشست را بررسی کنید.");
        return result;
      }
      setToast(success);
      return result;
    } catch (error) { setToast(error instanceof Error ? error.message : "خطای نامشخص"); return null; }
    finally { setBusy(false); }
  }

  function openProject(project?: Project) {
    setEditingId(project?.id || null);
    setForm({ name: project?.name || "", code: project?.code || "", type: project?.type || "مسکونی", province: project?.province || "",
      city: project?.city || "", area: project?.area || "", floors: String(project?.floors ?? 0), basements: String(project?.basements ?? 0),
      structure: project?.structure || "", foundation: project?.foundation || "", employer: project?.employer || "",
      contractor: project?.contractor || "", contractType: project?.contractType || "", fundingType: project?.fundingType || "private",
      pricingBasis: project?.pricingBasis || "market", contractReference: project?.contractReference || "",
      estimateDate: project?.estimateDate || "", stage: project?.stage || "conceptual", notes: project?.notes || "" });
    setModal("project");
  }
  async function submitProject(event: FormEvent) {
    event.preventDefault();
    const result = await mutate("/api/projects", editingId ? "PATCH" : "POST", { ...form, floors: Number(f("floors")), basements: Number(f("basements")),
      ...(editingId ? { id: editingId, action: "update" } : {}) }, editingId ? "مشخصات پروژه به‌روزرسانی شد." : "پروژه جدید ایجاد شد.");
    if (result) { if (!editingId && result.project?.id) selectProject(result.project.id); setModal(null); }
  }

  function openTakeoff(row?: Takeoff) {
    setEditingId(row?.id || null);
    setForm({ projectId: row?.projectId || selected?.id || "", title: row?.title || "", category: row?.category || "بتن‌ریزی",
      floor: row?.floor || "", location: row?.location || "", kind: row?.kind || "volume", length: row?.length || "",
      width: row?.width || "", height: row?.height || "", count: row?.count || "1", unitWeight: row?.unitWeight || "",
      deduction: row?.deduction || "0", sourceNote: row?.sourceNote || "", ruleReference: row?.ruleReference || "",
      documentId: row?.documentId || "" });
    setModal("takeoff");
  }
  async function submitTakeoff(event: FormEvent) {
    event.preventDefault();
    const payload = { ...form, documentId: f("documentId") || null, ...(editingId ? { id: editingId, action: "update" } : {}) };
    const result = await mutate("/api/takeoffs", editingId ? "PATCH" : "POST", payload,
      editingId ? "مقدار بازحساب شد و برای تأیید مجدد به پیش‌نویس برگشت." : "ردیف متره با فرمول ثبت شد.");
    if (result) setModal(null);
  }

  function openPrice(price?: Price) {
    setEditingId(price?.id || null);
    setForm({ title: price?.title || "", code: price?.code || "", category: price?.category || "", unit: price?.unit || "مترمکعب",
      basis: price?.basis || selected?.pricingBasis || "market", amount: price?.amount || "", currency: price?.currency || "IRR",
      sourceName: price?.sourceName || "", sourceUrl: price?.sourceUrl || "", supplier: price?.supplier || "",
      region: price?.region || "", priceDate: price?.priceDate || "",
      validUntil: price?.validUntil || "", referenceId: price?.referenceId || "", confirmed: false });
    setModal("price");
  }
  async function submitPrice(event: FormEvent) {
    event.preventDefault();
    const result = await mutate("/api/prices", editingId ? "PATCH" : "POST",
      { ...form, referenceId: f("referenceId") || null, confirmed: form.confirmed === true, ...(editingId ? { id: editingId } : {}) },
      editingId ? "بهای واحد به‌روزرسانی شد." : "بهای واحد با منبع ثبت شد.");
    if (result) setModal(null);
  }

  function openReference(ref?: Reference) {
    setEditingId(ref?.id || null);
    setForm({ title: ref?.title || "", kind: ref?.kind || "pricebook", issuer: ref?.issuer || "", documentNumber: ref?.documentNumber || "",
      issueDate: ref?.issueDate || "", effectiveDate: ref?.effectiveDate || "", basePeriod: ref?.basePeriod || "", scope: ref?.scope || "",
      amendments: ref?.amendments || "", replacement: ref?.replacement || "", url: ref?.url || "", notes: ref?.notes || "" });
    setModal("reference");
  }
  function prefillReference(doc: OfficialDocument) {
    setEditingId(null);
    setForm({ title: doc.title, kind: doc.kind, issuer: doc.issuer, documentNumber: doc.documentNumber || "", issueDate: doc.issueDate || "",
      effectiveDate: doc.effectiveDate || "", basePeriod: doc.basePeriod || "", scope: doc.scope, amendments: "", replacement: "", url: "",
      notes: `شناسایی اولیه (تأییدنشده): ${doc.identifiedFrom} ${doc.verificationAttempt} لینک دقیق سند را از ${doc.portalName} وارد کنید.` });
    setModal("reference");
  }
  async function submitReference(event: FormEvent) {
    event.preventDefault();
    const result = await mutate("/api/references", editingId ? "PATCH" : "POST", { ...form, ...(editingId ? { id: editingId, action: "update" } : {}) },
      editingId ? "سند ویرایش شد و نیازمند تأیید مجدد است." : "سند با وضعیت بررسی‌نشده ثبت شد.");
    if (result) setModal(null);
  }
  async function submitDocument(event: FormEvent) {
    event.preventDefault();
    if (!uploadFile || !selected) { setToast("فایل و پروژه را انتخاب کنید."); return; }
    if (uploadFile.size > MAX_DOCUMENT_BYTES) { setToast("حجم فایل نباید از ۳ مگابایت بیشتر باشد."); return; }
    setBusy(true);
    try {
      const body = new FormData(); body.append("projectId", selected.id); body.append("file", uploadFile);
      body.append("version", f("version") || "نسخه ۱"); body.append("description", f("description"));
      const response = await sessionFetch("/api/documents", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "بارگذاری ناموفق بود.");
      await refresh(true); setModal(null); setUploadFile(null); setToast("سند به‌صورت خصوصی ذخیره شد.");
    } catch (error) { setToast(error instanceof Error ? error.message : "خطای بارگذاری"); }
    finally { setBusy(false); }
  }
  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    const result = await mutate("/api/auth", "POST", { action: authMode, email: f("email"), password: f("password"), name: f("name") },
      authMode === "register" ? "حساب ساخته شد و اطلاعات این فضای کار حفظ شد." : "با موفقیت وارد شدید.");
    if (result) setModal(null);
  }
  async function saveEstimate() {
    if (!selected) return;
    const result = await mutate("/api/estimates", "POST", { projectId: selected.id, notes: f("estimateNotes") }, "نسخه ثابت برآورد ثبت شد.");
    if (result) setForm((old) => ({ ...old, estimateNotes: "" }));
  }
  function downloadLink(projectId: string, format: string, snapshotId?: string) {
    return `/api/export?projectId=${encodeURIComponent(projectId)}&format=${format}${snapshotId ? `&snapshotId=${snapshotId}` : ""}`;
  }
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name || "پروژه حذف‌شده";
  const panelAction = (label: string, onClick: () => void) => <button type="button" className="text-link" onClick={onClick}>{label}<ArrowLeft size={16} /></button>;

  function renderDashboard() {
    if (!data) return null;
    const active = projects.filter((p) => p.status === "active");
    const allRows = data.takeoffs;
    const lastProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
    return <>
      <div className="page-intro dashboard-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> نمای کلی فضای کار <span className="eyebrow-divider">/</span> {dateFa(new Date().toISOString())}</div>
        <h1>سلام، {data.user.name} <span className="greeting-wave">👋</span></h1><p>پروژه‌هایتان را با دیدی روشن و محاسباتی قابل پیگیری پیش ببرید.</p></div>
        <button className="button button-primary" onClick={() => openProject()}><Plus size={18} /> پروژه جدید</button></div>
      <div className="hero-card"><div className="hero-text"><span className="hero-eyebrow"><ShieldCheck size={15} /> مسیر مهندسیِ قابل اعتماد</span>
        <h2>هر عدد، یک مسیر روشن<br />از اندازه‌گیری تا تصمیم.</h2><p>مقادیر را ثبت کنید، منبع را مشخص کنید و فقط با داده‌های تأییدشده برآورد بسازید.</p>
        <button onClick={() => navigate("takeoff")} className="hero-button">شروع متره پروژه <ArrowLeft size={17} /></button></div>
        <div className="hero-art" aria-hidden="true"><div className="plan-ring ring-one" /><div className="plan-ring ring-two" /><div className="plan-grid" />
          <div className="plan-center"><Layers3 size={33} strokeWidth={1.4} /></div><span className="plan-tag tag-one">۰۱ / اندازه‌گیری</span>
          <span className="plan-tag tag-two">۰۲ / بازبینی</span><span className="plan-tag tag-three">۰۳ / برآورد</span></div></div>
      <div className="notice-bar"><div className="notice-icon"><Info size={18} /></div><p><strong>یک نکته مهم:</strong> پروژه‌ها و مقادیر اولیه با برچسب «آموزشی» فقط برای آشنایی‌اند؛ هیچ قیمت یا ضابطه رسمی پیش‌فرض اعمال نمی‌شود.</p>
        <button onClick={() => navigate("references")}>مدیریت منابع <ArrowLeft size={15} /></button></div>
      <div className="stat-grid">
        {[
          { label: "پروژه‌های فعال", value: active.length, detail: `از ${fa(projects.length)} پروژه در فضای کار`, icon: Building2, tone: "teal" },
          { label: "ردیف‌های متره", value: allRows.length, detail: "مقادیر هندسی ثبت‌شده", icon: Ruler, tone: "blue" },
          { label: "نیازمند بازبینی", value: allRows.filter((r) => r.status !== "confirmed").length, detail: "پیش‌نویس و داده آموزشی", icon: Clock3, tone: "amber" },
          { label: "نسخه‌های برآورد", value: data.estimates.length, detail: "خروجی‌های ثابت و قابل بازیابی", icon: ClipboardList, tone: "purple" },
        ].map((stat) => <div className="stat-card" key={stat.label}><div className={`stat-icon icon-${stat.tone}`}><stat.icon size={20} strokeWidth={1.8} /></div>
          <span className="stat-label">{stat.label}</span><strong>{fa(stat.value)}</strong><small>{stat.detail}</small><span className={`stat-accent accent-${stat.tone}`} /></div>)}
      </div>
      <div className="dashboard-grid"><section className="panel recent-projects"><PanelTitle title="پروژه‌های اخیر" subtitle="دسترسی سریع به پروژه‌هایی که روی آن‌ها کار می‌کنید" action={panelAction("همه پروژه‌ها", () => navigate("projects"))} />
        {lastProjects.length ? <div className="project-table-wrap"><table className="data-table project-table"><thead><tr><th>پروژه</th><th>مرحله</th><th>ردیف متره</th><th>وضعیت</th><th /></tr></thead><tbody>
          {lastProjects.map((project) => { const rows = data.takeoffs.filter((r) => r.projectId === project.id); return <tr key={project.id} onClick={() => { selectProject(project.id); navigate("projects"); }} className="clickable-row">
            <td><div className="table-project"><span className="project-avatar"><Building2 size={19} /></span><span><strong>{project.name}</strong><small>{project.city || "شهر ثبت نشده"} · {project.type}{project.isDemo ? " · آموزشی" : ""}</small></span></div></td>
            <td><Badge tone="blue">{stageLabels[project.stage] || project.stage}</Badge></td><td>{fa(rows.length)} ردیف</td>
            <td><span className={`status-dot ${project.status === "active" ? "on" : "off"}`} />{project.status === "active" ? "فعال" : "آرشیو"}</td><td><ChevronLeft size={17} className="muted-chevron" /></td></tr>; })}
        </tbody></table></div> : <Empty icon={Building2} title="هنوز پروژه‌ای ندارید" description="اولین پروژه را بسازید و اطلاعات پایه آن را ثبت کنید." action={<button className="button button-primary" onClick={() => openProject()}>پروژه جدید</button>} />}</section>
        <section className="panel progress-panel"><PanelTitle title="آمادگی پروژه منتخب" subtitle={selected?.name || "پروژه‌ای انتخاب نشده"} />
          {selected ? <><div className="progress-visual"><div className="progress-ring" style={{ background: `conic-gradient(var(--teal) ${readyPercent}%, var(--ring-track) 0)` }}><div><strong>{fa(readyPercent)}٪</strong><span>تأیید متره</span></div></div></div>
            <div className="progress-list"><div><span><span className="mini-dot teal" /> ردیف تأییدشده</span><strong>{fa(confirmedCount)}</strong></div>
              <div><span><span className="mini-dot amber" /> نیازمند بررسی</span><strong>{fa(currentRows.length - confirmedCount)}</strong></div>
              <div><span><span className="mini-dot blue" /> مدارک بارگذاری‌شده</span><strong>{fa(currentDocs.length)}</strong></div></div>
            <button className="progress-link" onClick={() => navigate("takeoff")}>بررسی ریزمتره <ArrowLeft size={16} /></button></> : <p className="muted">ابتدا پروژه‌ای ایجاد کنید.</p>}</section></div>
      <div className="bottom-grid"><section className="panel activity-panel"><PanelTitle title="آخرین فعالیت‌ها" subtitle="تاریخچه تغییرات ثبت‌شده در فضای کار" action={panelAction("گزارش‌ها", () => navigate("reports"))} />
        {data.activity.length ? <div className="activity-list">{data.activity.slice(0, 4).map((event) => <div className="activity-item" key={event.id}><span className="activity-icon"><Activity size={16} /></span><div><strong>{activityText(event)}</strong><small>{event.projectId ? projectName(event.projectId) : "فضای کار"} · {dateFa(event.createdAt)}</small></div></div>)}</div> : <div className="activity-empty"><Activity size={18} /> با اولین تغییر، تاریخچه فعالیت اینجا نمایش داده می‌شود.</div>}</section>
        <section className="panel quick-panel"><PanelTitle title="میان‌بُرهای کار" subtitle="قدم بعدی را سریع‌تر بردارید" />
          <button onClick={() => openTakeoff()}><span className="quick-icon q-teal"><Ruler size={19} /></span><span><strong>ثبت مقدار جدید</strong><small>با فرمول و منبع اندازه‌گیری</small></span><ChevronLeft size={17} /></button>
          <button onClick={() => openPrice()}><span className="quick-icon q-blue"><Tags size={19} /></span><span><strong>افزودن بهای واحد</strong><small>با منبع، تاریخ و واحد مشخص</small></span><ChevronLeft size={17} /></button>
          <button onClick={() => { setGuideOpen(true); }}><span className="quick-icon q-amber"><ShieldCheck size={19} /></span><span><strong>کنترل آماده‌سازی</strong><small>بررسی داده‌های ناقص پروژه</small></span><ChevronLeft size={17} /></button></section></div>
      <ReadinessPanel
        project={selected ? { id: selected.id, name: selected.name, pricingBasis: selected.pricingBasis, contractReference: selected.contractReference, stage: selected.stage, isDemo: selected.isDemo } : undefined}
        takeoffs={currentRows.map((r) => ({ id: r.id, projectId: r.projectId, title: r.title, quantity: r.quantity, unit: r.unit, status: r.status, isDemo: r.isDemo, sourceNote: r.sourceNote, priceId: r.priceId, pricebookItemId: r.pricebookItemId, certainty: r.certainty }))}
        prices={data.prices.map((p) => ({ id: p.id, unit: p.unit, basis: p.basis, amount: p.amount, currency: p.currency, sourceName: p.sourceName, priceDate: p.priceDate, confirmed: p.confirmed, referenceId: p.referenceId }))}
        references={data.references.map((r) => ({ id: r.id, kind: r.kind, status: r.status, title: r.title }))}
        validity={data.rowValidity as ValidityLite}
        isOfficialActive={data.editions.some((e) => e.status === "active")}
        onNavigate={(v) => navigate(v as View)}
      />
    </>;
  }

  function renderProjects() {
    if (!data) return null;
    const filtered = projects.filter((p) => (projectFilter === "all" || p.status === projectFilter) &&
      `${p.name} ${p.code || ""} ${p.city || ""}`.toLowerCase().includes(localSearch.toLowerCase()));
    return <><div className="page-intro"><div><div className="eyebrow">مدیریت پروژه‌ها <span className="eyebrow-divider">/</span> {fa(projects.length)} پروژه</div><h1>پروژه‌ها</h1><p>مشخصات، مرحله طراحی و مبنای مالی هر پروژه را مستقل مدیریت کنید.</p></div><button className="button button-primary" onClick={() => openProject()}><Plus size={18} /> پروژه جدید</button></div>
      <div className="toolbar"><div className="segmented">{[["active", "فعال"], ["archived", "آرشیو"], ["all", "همه"]].map(([id, label]) => <button key={id} className={projectFilter === id ? "selected" : ""} onClick={() => setProjectFilter(id)}>{label}</button>)}</div><div className="filter-search"><Search size={17} /><input placeholder="جست‌وجوی نام، شهر یا کد پروژه..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} /></div></div>
      {filtered.length ? <div className="project-cards">{filtered.map((p) => { const rows = data.takeoffs.filter((r) => r.projectId === p.id); const approved = rows.filter((r) => r.status === "confirmed").length; return <article className={`project-card ${selected?.id === p.id ? "project-card-selected" : ""}`} key={p.id}>
        <div className="project-card-top"><div className="project-card-symbol"><Building2 size={25} strokeWidth={1.5} /></div><div className="project-card-actions"><button title="ویرایش" onClick={() => openProject(p)}><Pencil size={16} /></button><button title="تکثیر" onClick={() => void mutate("/api/projects", "POST", { action: "duplicate", id: p.id }, "پروژه و ردیف‌های متره به‌صورت پیش‌نویس تکثیر شدند.")}><Copy size={16} /></button></div></div>
        <div className="project-card-tags"><Badge tone={p.status === "active" ? "green" : "neutral"}>{p.status === "active" ? "فعال" : "آرشیو"}</Badge>{p.isDemo && <Badge tone="orange">آموزشی</Badge>}</div>
        <h3>{p.name}</h3><p className="project-card-location"><MapPin size={15} /> {p.city || "شهر نامشخص"} · {p.type}</p>
        <div className="project-card-facts"><span>مرحله <strong>{stageLabels[p.stage] || p.stage}</strong></span><span>زیربنا <strong>{p.area ? `${fa(p.area)} م²` : "ثبت نشده"}</strong></span></div>
        <div className="project-card-progress"><div className="progress-label"><span>متره تأییدشده</span><strong>{fa(approved)} / {fa(rows.length)}</strong></div><div className="progress-track"><span style={{ width: `${rows.length ? approved / rows.length * 100 : 0}%` }} /></div></div>
        <button className="project-open" onClick={() => { selectProject(p.id); navigate("takeoff"); }}>ورود به پروژه <ArrowLeft size={17} /></button></article>; })}</div> : <Empty icon={Building2} title="پروژه‌ای در این بخش نیست" description="فیلتر را تغییر دهید یا یک پروژه جدید ایجاد کنید." action={<button className="button button-primary" onClick={() => openProject()}>ایجاد پروژه</button>} />}
      {selected && <section className="panel selected-project-panel"><PanelTitle title="مشخصات پروژه انتخاب‌شده" subtitle={selected.name} action={<button className="button button-outline button-sm" onClick={() => openProject(selected)}><Pencil size={15} /> ویرایش مشخصات</button>} />
        <div className="detail-grid">{[["شناسه پروژه", selected.code || "ثبت نشده"], ["نوع ساختمان", selected.type], ["موقعیت", [selected.province, selected.city].filter(Boolean).join("، ") || "ثبت نشده"],
          ["تعداد طبقات", fa(selected.floors)], ["زیرزمین", fa(selected.basements)], ["سیستم سازه‌ای", selected.structure || "ثبت نشده"],
          ["منبع تأمین مالی", selected.fundingType === "public" ? "عمومی" : selected.fundingType === "partnership" ? "مشارکتی" : "خصوصی"],
          ["مبنای قیمت‌گذاری", basisLabels[selected.pricingBasis] || selected.pricingBasis]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="detail-actions"><button onClick={() => void mutate("/api/projects", "PATCH", { id: selected.id, action: "status", status: selected.status === "active" ? "archived" : "active" }, selected.status === "active" ? "پروژه بایگانی شد." : "پروژه بازیابی شد.")}><Archive size={16} /> {selected.status === "active" ? "بایگانی پروژه" : "بازیابی پروژه"}</button><button className="danger-text" onClick={() => { setForm({ confirmName: "" }); setModal("deleteProject"); }}><Trash2 size={16} /> حذف کنترل‌شده</button></div></section>}
    </>;
  }

  function renderTakeoff() {
    const visible = currentRows.filter((r) => `${r.title} ${r.category} ${r.floor || ""} ${r.location || ""}`.toLowerCase().includes(localSearch.toLowerCase()));
    return <><div className="page-intro"><div><div className="eyebrow">پروژه <span className="eyebrow-divider">/</span> {selected?.name || "انتخاب نشده"}</div><h1>متره و مقادیر</h1><p>اندازه‌گیری هندسیِ قابل ردیابی؛ هر ردیف با ابعاد، فرمول و منبع خودش.</p></div><div className="intro-actions">{selected && currentRows.length > 0 && <><a className="button button-outline" href={`/report/takeoff/${selected.id}`}><Printer size={16} /> گزارش چاپی</a><a className="button button-outline" href={`/api/export/takeoff?projectId=${selected.id}`}><FileSpreadsheet size={16} /> Excel ریزمتره</a></>}<button className="button button-outline" disabled={!selected} onClick={() => openTakeoff()}><Plus size={17} /> ردیف ساده</button><button className="button button-primary" disabled={!selected} onClick={() => setCalc({})}><Sigma size={18} /> محاسبه با قاعده</button></div></div>
      <div className="info-banner"><div><Info size={19} /></div><p>فرمول‌های این بخش فقط هندسه پایه هستند؛ قواعد اختصاصی کسر بازشو، پرت و روش پرداختِ فهرست‌بها بدون ضابطه تأییدشده اعمال نمی‌شوند.</p></div>
      <div className="mini-stats"><div><span>کل ردیف‌ها</span><strong>{fa(currentRows.length)}</strong></div><div><span>تأییدشده</span><strong>{fa(confirmedCount)}</strong></div><div><span>نیازمند بررسی</span><strong>{fa(currentRows.length - confirmedCount)}</strong></div><div><span>مرتبط با سند</span><strong>{fa(currentRows.filter((r) => r.documentId).length)}</strong></div></div>
      {outdatedRows.length > 0 && <div className="outdated-banner" data-testid="outdated-banner">
        <Info size={18} /><div><strong>برای {fa(outdatedRows.length)} ردیف، نسخه جدیدتری از قاعده منتشر شده است</strong>
          <p>این ردیف‌ها با نسخه ثبت‌شده خودشان معتبرند و در برآورد منظور می‌شوند؛ بازمحاسبه اختیاری است.</p></div>
      </div>}
      {affectedRows.length > 0 && <div className="validity-banner" data-testid="validity-banner">
        <ShieldAlert size={19} /><div><strong>{fa(affectedRows.length)} ردیف پس از تغییر قاعده نیازمند بازبینی است</strong>
          <p>مقدار و ردیابی این ردیف‌ها دست‌نخورده مانده است، اما تا بازمحاسبه و تأیید مجدد در برآورد به‌کار نمی‌روند. نسخه‌های ثبت‌شده برآورد نیز تغییر نمی‌کنند.</p></div>
        <ul>{affectedRows.slice(0, 4).map((row) => <li key={row.id}><strong>{row.title}</strong><span>{validityOf(row.id)?.label}</span></li>)}
          {affectedRows.length > 4 && <li className="more">و {fa(affectedRows.length - 4)} ردیف دیگر</li>}</ul>
      </div>}
      <section className="panel table-panel"><div className="table-toolbar"><div><h3>ریز متره</h3><p>برای مشاهده جزئیات محاسبه روی هر ردیف کلیک کنید.</p></div><div className="table-tools"><div className="filter-search compact"><Search size={16} /><input placeholder="جست‌وجوی ردیف..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} /></div><button className={`mode-button ${expert ? "is-active" : ""}`} onClick={toggleExpert}><SlidersHorizontal size={17} /> {expert ? "حالت تخصصی" : "حالت ساده"}</button></div></div>
        {!selected ? <Empty icon={Building2} title="پروژه‌ای انتخاب نشده" description="ابتدا یک پروژه ایجاد یا انتخاب کنید." /> : visible.length ? <div className="table-scroll"><table className="data-table takeoff-table"><thead><tr><th>شرح عملیات</th><th>محل / طبقه</th>{expert && <th>فرمول هندسی</th>}<th>مقدار</th><th>وضعیت</th><th>بهای مرتبط</th><th>اقدامات</th></tr></thead>
          {visible.map((row) => { const prices = data?.prices.filter((p) => !p.pricebookItemId && p.unit === row.unit && p.basis === selected.pricingBasis) || []; return <tbody key={row.id} className="row-group"><tr onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)} className="clickable-row"><td><div className="row-title"><span className="row-kind"><Ruler size={17} /></span><span><strong>{row.title}</strong><small>{row.category}{row.isDemo ? " · نمونه آموزشی" : ""}{row.ruleKey ? ` · ${row.ruleKey} v${row.ruleVersion}` : ""}</small></span></div></td><td>{row.floor || "—"}<small className="table-sub">{row.location || ""}</small></td>{expert && <td className="formula-cell" dir="ltr">{row.formula}</td>}
            <td><strong className="quantity-text">{fa(row.quantity, 4)}</strong><small className="table-sub">{row.unit}</small></td><td><Badge tone={row.isDemo ? "orange" : row.status === "confirmed" ? "green" : "neutral"}>{row.isDemo ? "آموزشی" : row.status === "confirmed" ? "تأییدشده" : "پیش‌نویس"}</Badge>{row.certainty === "provisional" && <> <Badge tone="orange">آزمایشی</Badge></>}
            {validityOf(row.id)?.state === "stale" && <Badge tone="orange">قاعده تغییر کرده</Badge>}
            {validityOf(row.id)?.state === "unusable" && <Badge tone="red">غیرقابل اتکا</Badge>}
            {validityOf(row.id)?.state === "outdated" && <Badge tone="blue">نسخه جدید قاعده موجود است</Badge>}</td>
            <td onClick={(e) => e.stopPropagation()}><select className="inline-select" aria-label={`بهای ${row.title}`} value={row.priceId || ""} onChange={(e) => void mutate("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: e.target.value || null }, "بهای واحد به ردیف متصل شد.")}><option value="">انتخاب بها...</option>{row.pricebookItemId && row.priceId && <option value={row.priceId} disabled>بهای تطبیق‌شده فهرست‌بها</option>}{prices.map((price) => <option key={price.id} value={price.id}>{price.title} · {fa(price.amount)} {price.currency === "IRR" ? "ریال" : "تومان"}</option>)}</select></td>
            <td onClick={(e) => e.stopPropagation()}><div className="row-actions">{!row.isDemo && <><button title={row.status === "confirmed" ? "بازگشت به پیش‌نویس" : "تأیید مقدار"} onClick={() => void mutate("/api/takeoffs", "PATCH", { id: row.id, action: row.status === "confirmed" ? "unconfirm" : "confirm" }, row.status === "confirmed" ? "ردیف به پیش‌نویس برگشت." : "مقدار با تأیید شما نهایی شد.")}><Check size={17} /></button><button title="ویرایش" onClick={() => row.ruleRef ? setCalc({ row }) : openTakeoff(row)}><Pencil size={16} /></button></>}
              <button title="پیشنهاد ردیف فهرست‌بها" onClick={() => setMatchRow(row)}><Link2 size={16} /></button><button title="حذف ردیف" className="danger-hover" onClick={() => { if (window.confirm(`ردیف «${row.title}» حذف شود؟`)) void mutate("/api/takeoffs", "DELETE", { id: row.id }, "ردیف حذف شد."); }}><Trash2 size={16} /></button></div></td></tr>
            {expandedRow === row.id && <tr className="expanded-tr"><td colSpan={expert ? 7 : 6}><div className="trace-panel"><div><span>شناسنامه محاسبه</span><strong>{kindLabels[row.kind]} · {row.unit}</strong></div><div><span>فرمول و ورودی‌ها</span><strong dir="ltr">{row.formula} = {fa(row.quantity, 4)}</strong></div><div><span>منبع مقدار</span><strong>{row.sourceNote || "ثبت نشده"}</strong></div><div><span>ضابطه واردشده توسط کاربر</span><strong>{row.ruleReference || "ثبت نشده؛ ضابطه رسمی اعمال نشده"}</strong></div></div>{row.ruleTrace && <RuleTraceView trace={row.ruleTrace} entry={data?.ruleBank.find((item) => item.ref === row.ruleRef)} duplicateNote={row.duplicateNote} validity={validityOf(row.id)} />}</td></tr>}</tbody>; })}
        </table></div> : <Empty icon={Ruler} title={localSearch ? "ردیفی یافت نشد" : "هنوز متره‌ای ثبت نشده"} description="برای هر عملیات، ابعاد و منبع مقدار را ثبت کنید. نتیجه به‌صورت پیش‌نویس ذخیره می‌شود." action={!localSearch ? <button className="button button-primary" onClick={() => openTakeoff()}>ثبت اولین ردیف</button> : undefined} />}</section>
      {currentRows.some((r) => r.isDemo) && <p className="footnote"><Info size={15} /> ردیف‌های آموزشی قابل تأیید یا استفاده در برآورد نیستند. برای پروژه واقعی، ردیف جدید بسازید.</p>}
    </>;
  }

  function renderEstimates() {
    return <><div className="page-intro"><div><div className="eyebrow">محاسبه مالی <span className="eyebrow-divider">/</span> {selected?.name || "انتخاب پروژه"}</div><h1>برآورد مالی</h1><p>مقدار تأییدشده × بهای مستند؛ نسخه‌ها مستقل و غیرقابل‌تغییر نگهداری می‌شوند.</p></div><button className="button button-outline" onClick={() => navigate("prices")}><Tags size={17} /> مدیریت قیمت‌ها</button></div>
      {selected && data && <ReadinessPanel
        project={{ id: selected.id, name: selected.name, pricingBasis: selected.pricingBasis, contractReference: selected.contractReference, stage: selected.stage, isDemo: selected.isDemo }}
        takeoffs={currentRows.map((r) => ({ id: r.id, projectId: r.projectId, title: r.title, quantity: r.quantity, unit: r.unit, status: r.status, isDemo: r.isDemo, sourceNote: r.sourceNote, priceId: r.priceId, pricebookItemId: r.pricebookItemId, certainty: r.certainty }))}
        prices={data.prices.map((p) => ({ id: p.id, unit: p.unit, basis: p.basis, amount: p.amount, currency: p.currency, sourceName: p.sourceName, priceDate: p.priceDate, confirmed: p.confirmed, referenceId: p.referenceId }))}
        references={data.references.map((r) => ({ id: r.id, kind: r.kind, status: r.status, title: r.title }))}
        validity={data.rowValidity as ValidityLite}
        isOfficialActive={data.editions.some((e) => e.status === "active")}
        onNavigate={(v) => navigate(v as View)}
      />}
      {!selected ? <Empty icon={Building2} title="ابتدا پروژه‌ای انتخاب کنید" description="برآورد به پروژه و مبنای قیمت آن وابسته است." /> : <>
        <div className="estimate-layout"><div className="estimate-main"><div className="estimate-hero"><div><span className="estimate-kicker">پیش‌نمایش جمع مستقیم ردیف‌ها</span><h2>{preview ? fa(preview.totalRial, 0) : "..."} <small>ریال</small></h2><p>بدون ضرایب، مالیات، بیمه، تجهیز کارگاه یا تعدیل</p></div><div className="estimate-watermark"><Calculator size={58} strokeWidth={1} /></div></div>
          <div className="estimate-metrics"><div><span>مبنای قیمت</span><strong>{basisLabels[selected.pricingBasis]}</strong></div><div><span>ردیف قابل محاسبه</span><strong>{fa(preview?.lines.length || 0)}</strong></div><div><span>ردیف پیش‌نویس</span><strong>{fa(preview?.draftCount || 0)}</strong></div></div>
          <section className="panel estimate-lines"><PanelTitle title="ریز برآورد آماده" subtitle="تنها ردیف‌های تأییدشده، هم‌واحد و هم‌مبنا محاسبه می‌شوند" />
            {preview?.lines.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>شرح عملیات</th><th>مقدار</th><th>بهای واحد (ریال)</th><th>مبلغ (ریال)</th></tr></thead><tbody>{preview.lines.map((line) => <tr key={line.takeoffId}><td><strong>{line.title}</strong><small className="table-sub">{line.priceSource} · {line.priceDate}</small></td><td>{fa(line.quantity, 4)} {line.unit}</td><td>{fa(line.unitPriceRial)}</td><td className="money-cell">{fa(line.amountRial, 0)}</td></tr>)}</tbody></table></div> : <Empty icon={Calculator} title="هنوز ردیف قابل محاسبه‌ای نیست" description="ابتدا متره واقعی را تأیید و بهای هم‌واحد با منبع مشخص به آن متصل کنید." action={<button className="button button-soft" onClick={() => navigate("takeoff")}>رفتن به متره <ArrowLeft size={16} /></button>} />}</section></div>
          <div className="estimate-side"><section className="panel estimate-check"><PanelTitle title="کنترل‌های پیش از ثبت" subtitle="موانع ثبت نسخه ثابت" />
            {!preview ? <p className="muted">در حال بررسی اطلاعات پروژه...</p> : preview.issues.length ? <div className="issue-list">{preview.issues.map((issue, index) => <div key={index}><span className="issue-icon">!</span><p>{issue}</p></div>)}</div> : <div className="all-clear"><CheckCircle2 size={30} /><strong>ردیف‌های تأییدشده آماده‌اند</strong><span>منبع مقدار و بها بررسی اولیه شد. تأیید فنی و قراردادی همچنان با کارشناس است.</span></div>}
            {preview && preview.draftCount > 0 && <p className="draft-caution">{fa(preview.draftCount)} ردیف پیش‌نویس در جمع منظور نشده است.</p>}
            <textarea className="input estimate-note" placeholder="یادداشت این نسخه (اختیاری)" value={f("estimateNotes")} onChange={(e) => change("estimateNotes", e.target.value)} />
            <button className="button button-primary full-width" disabled={!preview || !!preview.issues.length || busy} onClick={() => void saveEstimate()}><LockKeyhole size={17} /> {busy ? "در حال ثبت..." : "ثبت نسخه ثابت برآورد"}</button>
            <button className="button button-outline full-width scenario-open" disabled={!preview?.reviewHash || !!preview.issues.length || busy} onClick={() => { if (preview?.reviewHash) setScenarioReview({ projectId: selected.id, directTotal: preview.totalRial, reviewHash: preview.reviewHash }); }}>بررسی سناریوی ضرایب دستی</button></section>
            <section className="panel version-panel"><PanelTitle title="نسخه‌های ثبت‌شده" subtitle="تغییر داده‌ها نسخه‌های گذشته را عوض نمی‌کند" />
              {currentSnapshots.length ? currentSnapshots.map((snap) => <div className="version-item" key={snap.id}><div className="version-icon"><FileText size={18} /></div><div><strong>نسخه {fa(snap.version)}</strong><small>{dateFa(snap.createdAt)} · جمع مستقیم {fa(snap.totalRial, 0)} ریال{readCoefficientScenario(snap.projectSnapshot) && ` · سناریوی دستی ${fa(readCoefficientScenario(snap.projectSnapshot)!.finalTotalRial, 0)} ریال`}</small></div><a href={`/report/${snap.id}`} title="گزارش چاپی"><ArrowUpLeft size={18} /></a></div>) : <p className="muted small-empty">هنوز نسخه‌ای ثبت نشده است.</p>}</section></div></div>
      </>}
    </>;
  }

  function renderPrices() {
    if (!data) return null;
    const filtered = data.prices.filter((p) => (priceFilter === "all" || p.basis === priceFilter) &&
      `${p.title} ${p.code || ""} ${p.sourceName}`.toLowerCase().includes(localSearch.toLowerCase()));
    return <><div className="page-intro"><div><div className="eyebrow">داده‌های مالی <span className="eyebrow-divider">/</span> بانک مستقل قیمت</div><h1>بانک قیمت‌ها</h1><p>بهای بازار، اختصاصی و رسمی هرگز به‌صورت خودکار با هم ترکیب نمی‌شوند.</p></div><button className="button button-primary" onClick={() => openPrice()}><Plus size={18} /> بهای واحد جدید</button></div>
      <div className="info-banner"><div><ShieldCheck size={19} /></div><p>هیچ قیمت رسمی یا بازار به‌صورت پیش‌فرض وجود ندارد. هر بها باید منبع، تاریخ، واحد، مبنا و تأیید انسانی داشته باشد.</p></div>
      <div className="toolbar"><div className="segmented">{[["all", "همه قیمت‌ها"], ["market", "بازار آزاد"], ["contractor", "پیمانکار"], ["official", "فهرست‌بها"]].map(([id, label]) => <button key={id} className={priceFilter === id ? "selected" : ""} onClick={() => setPriceFilter(id)}>{label}</button>)}</div><div className="filter-search"><Search size={17} /><input placeholder="جست‌وجوی بها یا منبع..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} /></div></div>
      <section className="panel table-panel">{filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>عنوان و ردیف</th><th>مبنا</th><th>واحد</th><th>بهای واحد</th><th>منبع و تاریخ</th><th>وضعیت</th><th>اقدامات</th></tr></thead><tbody>{filtered.map((price) => <tr key={price.id}><td><strong>{price.title}</strong><small className="table-sub">{price.code || price.category || "بهای دستی"}</small></td><td><Badge tone={price.basis === "official" ? "blue" : price.basis === "market" ? "green" : "orange"}>{basisLabels[price.basis]}</Badge></td><td>{price.unit}</td><td className="money-cell">{fa(price.amount)} <small>{price.currency === "IRR" ? "ریال" : "تومان"}</small></td><td>{price.sourceName}<small className="table-sub">{price.priceDate}</small></td><td><Badge tone={price.confirmed ? "green" : "orange"}>{price.confirmed ? "بازبینی کاربر" : "در انتظار تأیید"}</Badge></td><td><div className="row-actions">{!price.pricebookItemId ? <button title="ویرایش" onClick={() => openPrice(price)}><Pencil size={16} /></button> : <span title="بهای متصل به فهرست‌بها قابل ویرایش نیست"><LockKeyhole size={16} /></span>}<button className="danger-hover" title="حذف" onClick={() => { if (window.confirm(`بهای «${price.title}» حذف شود؟`)) void mutate("/api/prices", "DELETE", { id: price.id }, "بهای واحد حذف شد."); }}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <Empty icon={Tags} title="هنوز بهایی در این بخش نیست" description="نرخ‌های واقعی خود را با منبع، تاریخ و واحد مشخص ثبت کنید؛ سیستم هیچ قیمتی را حدس نمی‌زند." action={<button className="button button-primary" onClick={() => openPrice()}>ثبت بهای واحد</button>} />}</section>
    </>;
  }

  function renderDocuments() {
    return <><div className="page-intro"><div><div className="eyebrow">مستندات پروژه <span className="eyebrow-divider">/</span> {selected?.name || "انتخاب پروژه"}</div><h1>نقشه‌ها و اسناد</h1><p>فایل‌های پروژه را به‌صورت خصوصی، نسخه‌دار و مرتبط با مقادیر نگهداری کنید.</p></div><button className="button button-primary" disabled={!selected} onClick={() => { setForm({ version: `نسخه ${currentDocs.length + 1}`, description: "" }); setUploadFile(null); setModal("document"); }}><UploadCloud size={18} /> بارگذاری سند</button></div>
      <div className="document-layout"><section className="panel documents-panel"><PanelTitle title="فایل‌های پروژه" subtitle="PDF و تصویر؛ هر فایل حداکثر ۳ مگابایت" action={<Badge tone="blue">{fa(currentDocs.length)} فایل</Badge>} />
        {currentDocs.length ? <div className="document-list">{currentDocs.map((doc) => <div className="document-item" key={doc.id}><div className={`document-type ${doc.mimeType === "application/pdf" ? "pdf" : "image"}`}><FileText size={22} /></div><div className="document-info"><strong>{doc.fileName}</strong><small>{doc.version} · {fa(Math.ceil(doc.sizeBytes / 1024))} کیلوبایت · {dateFa(doc.uploadedAt)}</small>{doc.description && <small>{doc.description}</small>}</div><div className="row-actions"><button title="مشاهده" onClick={() => setPreviewDoc(doc)}><Eye size={18} /></button><button className="danger-hover" title="حذف" onClick={() => { if (window.confirm(`فایل «${doc.fileName}» حذف شود؟`)) void mutate("/api/documents", "DELETE", { id: doc.id }, "سند حذف شد."); }}><Trash2 size={17} /></button></div></div>)}</div> : <Empty icon={Files} title="سندی بارگذاری نشده است" description="نقشه یا سند PDF/JPG/PNG را اضافه کنید تا منبع مقادیر پروژه قابل ارجاع باشد." action={selected ? <button className="button button-primary" onClick={() => { setForm({ version: "نسخه ۱", description: "" }); setModal("document"); }}>افزودن سند</button> : undefined} />}</section>
        <div className="document-side"><section className="panel"><div className="side-icon"><Layers3 size={21} /></div><h3>ارتباط سند با متره</h3><p>هنگام ثبت ردیف متره، فایل منبع و محل اندازه‌گیری را انتخاب و توضیح دهید. این ارتباط در شناسنامه مقدار باقی می‌ماند.</p><button className="text-link" onClick={() => navigate("takeoff")}>رفتن به متره <ArrowLeft size={16} /></button></section><section className="panel limitation-card"><Info size={19} /><h3>محدوده پشتیبانی</h3><p>در این نسخه نمایش PDF/تصویر فراهم است. اندازه‌گیری کالیبره روی نقشه، OCR، DWG و IFC هنوز پیاده‌سازی یا اعتبارسنجی نشده‌اند.</p></section></div></div>
    </>;
  }

  function renderReferences() {
    if (!data) return null;
    return <><div className="page-intro"><div><div className="eyebrow">حاکمیت داده <span className="eyebrow-divider">/</span> منابع مرجع</div><h1>منابع و ضوابط</h1><p>برای هر سند، هویت، دامنه کاربرد، تاریخ و وضعیت بازبینی را جداگانه نگهداری کنید.</p></div><button className="button button-primary" onClick={() => openReference()}><Plus size={18} /> ثبت سند مرجع</button></div>
      <div className="source-warning"><ShieldCheck size={21} /><div><strong>اصل اعتبار منبع</strong><p>شناسایی یک درگاه رسمی به‌معنای تأیید متن، آخرین اصلاحیه یا شمول آن در پیمان شما نیست. هیچ ضابطه‌ای خودکار فعال نمی‌شود.</p></div></div>
      <div className="source-portals"><a href="https://sama.mporg.ir/" target="_blank" rel="noopener noreferrer"><span className="portal-icon"><BookOpen size={20} /></span><div><strong>سامانه ضوابط نظام فنی و اجرایی</strong><small>درگاه سازمان برنامه و بودجه · برای بررسی اصل سند</small></div><ExternalLink size={16} /></a><a href="https://inbr.ir/" target="_blank" rel="noopener noreferrer"><span className="portal-icon"><Building2 size={20} /></span><div><strong>دفتر مقررات ملی ساختمان</strong><small>درگاه مباحث و اصلاحیه‌ها · برای بررسی ویرایش</small></div><ExternalLink size={16} /></a></div>
      <section className="panel table-panel"><PanelTitle title="اسناد ثبت‌شده در فضای کار" subtitle="تأیید این بخش، بازبینی توسط مالک است؛ نه گواهی رسمی ناشر" action={<Badge tone="blue">{fa(data.references.length)} سند</Badge>} />
        {data.references.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>عنوان سند</th><th>دسته</th><th>صادرکننده</th><th>شماره / تاریخ</th><th>وضعیت</th><th>اقدامات</th></tr></thead><tbody>{data.references.map((ref) => <tr key={ref.id}><td><strong>{ref.title}</strong><small className="table-sub">{ref.scope ? ref.scope.slice(0, 70) : "دامنه شمول ثبت نشده"}</small></td><td>{refLabels[ref.kind] || ref.kind}</td><td>{ref.issuer}</td><td>{ref.documentNumber || "—"}<small className="table-sub">{ref.issueDate || "تاریخ ثبت نشده"}</small></td><td><Badge tone={ref.status === "verified" ? "green" : ref.status === "superseded" ? "red" : "orange"}>{ref.status === "verified" ? "بازبینی کاربر" : ref.status === "superseded" ? "منسوخ" : "بررسی‌نشده"}</Badge></td><td><div className="row-actions"><button title="ویرایش" onClick={() => openReference(ref)}><Pencil size={16} /></button>{ref.url && <a title="مشاهده مرجع" href={ref.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /></a>}<button title={ref.status === "verified" ? "لغو تأیید" : "تأیید پس از بازبینی"} onClick={() => { if (window.confirm("آیا نسخه، اصالت و دامنه شمول سند را شخصاً با مرجع بررسی کرده‌اید؟")) void mutate("/api/references", "PATCH", { id: ref.id, action: "status", status: ref.status === "verified" ? "unverified" : "verified" }, "وضعیت بازبینی سند ثبت شد."); }}><BadgeCheck size={17} /></button><button className="danger-hover" title="حذف" onClick={() => { if (window.confirm(`سند «${ref.title}» حذف شود؟`)) void mutate("/api/references", "DELETE", { id: ref.id }, "سند حذف شد."); }}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <Empty icon={BookOpen} title="بانک منابع هنوز خالی است" description="سند را با شماره، صادرکننده، تاریخ اجرا و دامنه شمول ثبت کنید؛ سپس نسخه مرجع را بازبینی کنید." action={<button className="button button-primary" onClick={() => openReference()}>ثبت اولین سند</button>} />}</section>
    </>;
  }

  function renderReports() {
    if (!data) return null;
    return <><div className="page-intro"><div><div className="eyebrow">خروجی‌ها <span className="eyebrow-divider">/</span> نسخه‌های ثابت</div><h1>گزارش‌ها و خروجی‌ها</h1><p>نسخه‌های پیشین با همان داده‌های ثبت‌شده باقی می‌مانند و قابل بازیابی‌اند.</p></div></div>
      <div className="report-format-row"><div><div className="format-icon"><Printer size={22} /></div><strong>گزارش چاپی</strong><small>چاپ راست‌چین یا ذخیره PDF در مرورگر</small></div><div><div className="format-icon"><FileSpreadsheet size={22} /></div><strong>اکسل فرمول‌دار</strong><small>ریزمقادیر، بها، فرمول و مبانی</small></div><div><div className="format-icon"><Download size={22} /></div><strong>داده ساختاریافته</strong><small>CSV و JSON برای بازبینی و تبادل</small></div></div>
      <section className="panel report-list-panel"><PanelTitle title="آرشیو برآوردها" subtitle={`${fa(data.estimates.length)} نسخه ثبت‌شده در فضای کار`} />
        {data.estimates.length ? <div className="report-list">{data.estimates.map((snap) => <article className="report-item" key={snap.id}><div className="report-item-icon"><FileText size={23} /></div><div className="report-item-main"><strong>{projectName(snap.projectId)} <Badge tone="blue">نسخه {fa(snap.version)}</Badge></strong><small>{dateFa(snap.createdAt)} · {basisLabels[snap.basis]} · {fa(snap.rows.length)} ردیف</small></div><div className="report-item-amount"><strong>{fa(snap.totalRial, 0)}</strong><small>جمع مستقیم · ریال</small>{readCoefficientScenario(snap.projectSnapshot) && <small>سناریوی دستی: {fa(readCoefficientScenario(snap.projectSnapshot)!.finalTotalRial, 0)} ریال</small>}</div><div className="report-item-actions"><a title="گزارش چاپی / PDF" href={`/report/${snap.id}`}><Printer size={18} /></a><a title="اکسل" href={downloadLink(snap.projectId, "xlsx", snap.id)}><FileSpreadsheet size={18} /></a><a title="CSV" href={downloadLink(snap.projectId, "csv", snap.id)}><Download size={18} /></a><a title="JSON" href={downloadLink(snap.projectId, "json", snap.id)}><FileText size={18} /></a></div></article>)}</div> : <Empty icon={FileText} title="هنوز گزارشی وجود ندارد" description="پس از تأیید مقادیر و قیمت‌ها، در بخش برآورد یک نسخه ثابت ایجاد کنید." action={<button className="button button-primary" onClick={() => navigate("estimates")}>رفتن به برآورد</button>} />}</section>
      <p className="footnote"><Info size={15} /> خروجی‌ها جمع مستقیم ردیف‌ها را نشان می‌دهند؛ هیچ مالیات، ضریب، تعدیل یا کسورات بدون منبع محاسبه نشده است.</p>
    </>;
  }

  function activityText(event: Audit) {
    const entity: Record<string, string> = { project: "پروژه", takeoff: "ردیف متره", price: "بهای واحد", reference: "سند مرجع", document: "فایل", estimate: "نسخه برآورد", rule: "قاعده متره", review: "بازبینی متخصص", pricebook: "فهرست‌بها" };
    const action: Record<string, string> = { create: "ایجاد شد", update: "ویرایش شد", delete: "حذف شد", confirm: "تأیید شد", unconfirm: "به پیش‌نویس برگشت",
      snapshot: "ثبت شد", upload: "بارگذاری شد", archive: "بایگانی شد", archived: "بایگانی شد", active: "بازیابی شد", duplicate: "تکثیر شد", assign_price: "به قیمت متصل شد", status: "تغییر وضعیت یافت", approved: "تأیید شد", rejected: "رد شد", revoked: "لغو شد", create_version: "نسخه جدید گرفت", retire: "بازنشسته شد",
      import: "ردیف وارد کرد", match_confirm: "با فهرست‌بها تطبیق یافت", link_reference: "به سند متصل شد" };
    return `${entity[event.entityType] || "مورد"} ${action[event.action] || "تغییر کرد"}`;
  }

  const input = (key: string, label: string, placeholder = "", options: { required?: boolean; wide?: boolean; type?: string; hint?: string } = {}) =>
    <label className={`form-field ${options.wide ? "wide" : ""}`} key={key}><span>{label}{options.required && <em>*</em>}</span><input className="input" type={options.type || "text"} inputMode={options.type === "email" ? "email" : undefined}
      required={options.required} placeholder={placeholder} value={f(key)} onChange={(event) => change(key, event.target.value)} />{options.hint && <small>{options.hint}</small>}</label>;
  const selectField = (key: string, label: string, choices: [string, string][], wide = false) =>
    <label className={`form-field ${wide ? "wide" : ""}`} key={key}><span>{label}</span><select className="input" value={f(key)} onChange={(event) => change(key, event.target.value)}>{choices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>;
  const areaField = (key: string, label: string, placeholder = "", wide = true) =>
    <label className={`form-field ${wide ? "wide" : ""}`} key={key}><span>{label}</span><textarea className="input" placeholder={placeholder} rows={3} value={f(key)} onChange={(event) => change(key, event.target.value)} /></label>;

  let quantityPreview: ReturnType<typeof calculateQuantity> | null = null;
  if (modal === "takeoff") {
    try { quantityPreview = calculateQuantity({ kind: f("kind") as MeasurementKind, length: f("length"), width: f("width"),
      height: f("height"), count: f("count"), unitWeight: f("unitWeight"), deduction: f("deduction") }); } catch { quantityPreview = null; }
  }
  const guideChecks = selected ? [
    { done: currentDocs.length > 0, title: "مدرک پروژه", detail: currentDocs.length ? `${fa(currentDocs.length)} سند ثبت شده` : "نقشه یا سند منبع هنوز ثبت نشده", target: "documents" as View },
    { done: confirmedCount > 0, title: "تأیید متره", detail: `${fa(confirmedCount)} ردیف از ${fa(currentRows.length)} تأیید شده`, target: "takeoff" as View },
    { done: currentRows.some((r) => r.status === "confirmed" && !!r.priceId), title: "اتصال بهای واحد", detail: "هر ردیف باید بهای هم‌واحد و هم‌مبنا داشته باشد", target: "prices" as View },
    { done: selected.pricingBasis !== "official" || !!selected.contractReference, title: "مبنای قراردادی", detail: "برای فهرست‌بها، ارجاع صریح پیمان ضروری است", target: "projects" as View },
  ] : [];

  if (!data) return <div className={`loading-page ${dark ? "theme-dark" : ""}`}><div className="loading-logo">م</div><h1>مِترا</h1><p>{loadingError || "در حال آماده‌سازی فضای کاری شما..."}</p>{loadingError ? <><button className="button button-primary" onClick={() => void refresh()}>تلاش دوباره</button>{previewToken() && <button className="button button-outline" onClick={() => { if (window.confirm("فضای مهمان قبلی ممکن است قابل بازیابی نباشد. فضای جدید بسازیم؟ برای بازیابی اطلاعات حساب، پس از آن وارد شوید.")) { setPreviewToken(null); sessionEstablished.current = false; void refresh(false, true); } }}>شروع فضای جدید / ورود به حساب</button>}<a className="button button-outline" href="/" target="_blank" rel="noopener noreferrer">باز کردن سایت در برگه مستقل</a></> : <span className="loading-spinner" />}</div>;

  return <div className={`app-frame ${dark ? "theme-dark" : ""}`} dir="rtl" onClickCapture={(event) => {
    if (!previewToken() || !(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return;
    if (anchor.pathname.startsWith("/report/")) {
      event.preventDefault();
      setFallbackReport(anchor.pathname + anchor.search);
    } else if (anchor.pathname.startsWith("/api/export")) {
      event.preventDefault();
      void (async () => {
        try {
          const response = await sessionFetch(anchor.pathname + anchor.search, { cache: "no-store" });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || "دریافت خروجی ناموفق بود.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const download = document.createElement("a");
          download.href = url;
          download.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "metra-export";
          document.body.appendChild(download);
          download.click();
          download.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (error) { setToast(error instanceof Error ? error.message : "دریافت خروجی ناموفق بود."); }
      })();
    }
  }}>
    {mobileMenu && <button className="mobile-overlay" aria-label="بستن منو" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}><div className="sidebar-brand"><div className="brand-symbol"><span>م</span></div><div className="brand-copy"><strong>مِترا</strong><small>فضای کار مهندسی ساخت</small></div><button className="sidebar-close" onClick={() => setMobileMenu(false)} aria-label="بستن"><X size={20} /></button></div>
      <div className="workspace-switch"><div className="workspace-switch-icon"><Layers3 size={18} /></div><div><strong>فضای کاری من</strong><small>{data.user.isGuest ? "محیط آزمایشی شخصی" : "فضای شخصی"}</small></div><ChevronDown size={15} /></div>
      <nav className="sidebar-nav">{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={`nav-item ${view === id ? "nav-active" : ""}`}><Icon size={19} strokeWidth={1.9} /><span>{label}</span>{view === id && <span className="nav-active-mark" />}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><span className="sidebar-help-icon"><CircleHelp size={20} /></span><strong>در مسیر درست هستید؟</strong><p>اطلاعات ناقص پروژه را پیش از برآورد بررسی کنید.</p><button onClick={() => { setGuideOpen(true); setMobileMenu(false); }}>راهنمای کنترل <ArrowLeft size={15} /></button></div>
        <div className="sidebar-user" onClick={() => { setAuthMode(data.user.isGuest ? "register" : "login"); setForm({ name: "", email: data.user.email || "", password: "" }); setModal("auth"); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { setModal("auth"); } }}><span className="user-avatar"><Initials name={data.user.name} /></span><span><strong>{data.user.name}</strong><small>{data.user.isGuest ? "حساب مهمان" : data.user.email}</small></span><MoreHorizontal size={18} /></div></div></aside>
    <div className="main-frame"><header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="باز کردن منو"><Menu size={22} /></button><div className="breadcrumb"><span>فضای کار</span><ChevronLeft size={15} /><strong>{viewLabels[view]}</strong></div></div><div className="topbar-actions"><button className="search-trigger" onClick={() => { setGlobalSearch(""); setSearchOpen(true); }}><Search size={18} /><span>جست‌وجو در فضای کار...</span><kbd>Ctrl K</kbd></button><div className="header-divider" /><label className="project-picker"><Building2 size={17} /><select aria-label="انتخاب پروژه" value={selected?.id || ""} onChange={(e) => selectProject(e.target.value)}>{!selected && <option value="">انتخاب پروژه</option>}{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={14} /></label><button className="icon-button" title={dark ? "تم روشن" : "تم تاریک"} onClick={toggleTheme}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="top-avatar" title="حساب کاربری" onClick={() => { setAuthMode(data.user.isGuest ? "register" : "login"); setForm({ name: "", email: data.user.email || "", password: "" }); setModal("auth"); }}><Initials name={data.user.name} /></button></div></header>
      <main className="content">{memoryOnlySession && <div className="form-note" role="status">ذخیره‌سازی مرورگر مسدود است؛ با بارگذاری مجدد، نشست این برگه از دست می‌رود. برای حفظ پروژه‌ها حساب بسازید و بعداً دوباره وارد شوید.</div>}{view === "dashboard" && renderDashboard()}{view === "projects" && renderProjects()}{view === "takeoff" && renderTakeoff()}{view === "estimates" && renderEstimates()}{view === "progress" && <ProgressView snapshots={data.estimates.map((s) => ({ id: s.id, version: s.version, projectId: s.projectId, projectName: data.projects.find((p) => p.id === s.projectId)?.name, totalRial: s.totalRial, rows: s.rows, createdAt: s.createdAt, basis: s.basis }))} selectedProjectId={selected?.id} notify={setToast} />}{view === "prices" && renderPrices()}{view === "documents" && renderDocuments()}{view === "references" && renderReferences()}{view === "reports" && renderReports()}{view === "rules" && <RulesView bank={data.ruleBank} caseReviews={data.caseReviews} references={data.references} canCalculate={!!selected} onCalculate={(ref) => setCalc({ ref })} onPrefillReference={prefillReference} onChanged={() => refresh(true)} notify={setToast} />}{view === "pricebook" && <PricebookView editions={data.editions} references={data.references} onChanged={() => refresh(true)} notify={setToast} onOpenReferences={() => navigate("references")} />}<footer className="app-footer"><span>مِترا · فضای کار متره و برآورد</span><span>نتیجه محاسبه تابع داده و منبع تأییدشده است، نه ظاهر گزارش.</span></footer></main></div>

    {guideOpen && <div className="drawer-backdrop" onClick={() => setGuideOpen(false)}><aside className="guide-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-header"><div className="drawer-symbol"><ShieldCheck size={23} /></div><button onClick={() => setGuideOpen(false)} aria-label="بستن"><X size={21} /></button></div><span className="eyebrow">راهنمای مبتنی بر داده</span><h2>کنترل آماده‌سازی</h2><p>این راهنما فقط داده‌های ثبت‌شده را بررسی می‌کند؛ قانون یا قیمت جدید تولید نمی‌کند.</p><div className="guide-project">پروژه منتخب <strong>{selected?.name || "انتخاب نشده"}</strong></div><div className="guide-list">{guideChecks.map((check) => <button key={check.title} onClick={() => { navigate(check.target); setGuideOpen(false); }}><span className={`guide-check ${check.done ? "done" : "pending"}`}>{check.done ? <Check size={15} /> : "!"}</span><span><strong>{check.title}</strong><small>{check.detail}</small></span><ChevronLeft size={17} /></button>)}</div><div className="guide-footer"><Info size={17} /> تأیید نهایی صحت فنی و قراردادی با کارشناس مسئول است.</div></aside></div>}

    {searchOpen && <div className="modal-backdrop search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}><div className="command-panel"><div className="command-input"><Search size={21} /><input autoFocus placeholder="پروژه، ردیف متره یا بها را جست‌وجو کنید..." value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} /><button onClick={() => setSearchOpen(false)}><X size={18} /></button></div><div className="command-results"><span className="command-label">دسترسی سریع</span>{navGroups.flatMap((group) => group.items).filter((item) => !globalSearch || item.label.includes(globalSearch)).map((item) => <button key={item.id} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span><ArrowLeft size={16} /></button>)}{projects.filter((p) => globalSearch && `${p.name} ${p.city}`.includes(globalSearch)).slice(0, 5).map((p) => <button key={p.id} onClick={() => { selectProject(p.id); navigate("projects"); }}><Building2 size={18} /><span>{p.name} <small>پروژه</small></span><ArrowLeft size={16} /></button>)}{data.takeoffs.filter((r) => globalSearch && r.title.includes(globalSearch)).slice(0, 5).map((r) => <button key={r.id} onClick={() => { selectProject(r.projectId); navigate("takeoff"); setExpandedRow(r.id); }}><Ruler size={18} /><span>{r.title} <small>متره</small></span><ArrowLeft size={16} /></button>)}</div><div className="command-footer">برای جست‌وجوی سریع از Ctrl + K استفاده کنید</div></div></div>}

    {previewDoc && previewToken() && <FallbackDocument id={previewDoc.id} name={previewDoc.fileName} mimeType={previewDoc.mimeType} onClose={() => setPreviewDoc(null)} />}
    {previewDoc && !previewToken() && <div className="modal-backdrop document-preview-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewDoc(null); }}><div className="document-preview"><div className="document-preview-header"><div><strong>{previewDoc.fileName}</strong><small>{previewDoc.version} · فقط مشاهده</small></div><div><a href={`/api/documents?id=${previewDoc.id}`} title="باز کردن سند"><ExternalLink size={19} /></a><button onClick={() => setPreviewDoc(null)}><X size={21} /></button></div></div>{previewDoc.mimeType === "application/pdf" ? <iframe title={previewDoc.fileName} src={`/api/documents?id=${previewDoc.id}`} /> : <div className="document-image-wrap"><Image unoptimized width={1400} height={1000} style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} alt={previewDoc.fileName} src={`/api/documents?id=${previewDoc.id}`} /></div>}</div></div>}

    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className={`modal-panel ${["project", "takeoff", "reference"].includes(modal) ? "modal-wide" : ""}`} role="dialog" aria-modal="true"><div className="modal-header"><div><span className="eyebrow">{modal === "project" ? "مدیریت پروژه" : modal === "takeoff" ? "موتور متره هندسی" : modal === "price" ? "بانک قیمت" : modal === "reference" ? "کتابخانه منابع" : modal === "document" ? "اسناد پروژه" : modal === "auth" ? "حساب کاربری" : "عملیات حساس"}</span><h2>{modal === "project" ? editingId ? "ویرایش مشخصات پروژه" : "ایجاد پروژه جدید" : modal === "takeoff" ? editingId ? "ویرایش ردیف متره" : "ثبت ردیف متره" : modal === "price" ? editingId ? "ویرایش بهای واحد" : "بهای واحد جدید" : modal === "reference" ? editingId ? "ویرایش سند مرجع" : "ثبت سند مرجع" : modal === "document" ? "بارگذاری فایل پروژه" : modal === "auth" ? authMode === "register" ? "ساخت حساب کاربری" : "ورود به حساب" : "حذف پروژه"}</h2></div><button className="modal-close" aria-label="بستن" onClick={() => setModal(null)}><X size={21} /></button></div>
      {modal === "project" && <form onSubmit={submitProject}><div className="modal-body"><div className="form-section-title">اطلاعات پایه</div><div className="form-grid">{input("name", "نام پروژه", "مثلاً ساختمان مسکونی بهار", { required: true, wide: true })}{input("code", "کد پروژه", "اختیاری")}{selectField("type", "نوع ساختمان", [["مسکونی", "مسکونی"], ["اداری", "اداری"], ["تجاری", "تجاری"], ["مختلط", "مختلط"], ["بازسازی", "بازسازی"], ["سایر", "سایر"]])}{input("province", "استان", "مثلاً تهران")}{input("city", "شهر", "مثلاً تهران")}{input("area", "زیربنای کل (مترمربع)", "مثلاً ۱۲۵۰")}{input("floors", "تعداد طبقات", "۰", { type: "number" })}{input("basements", "تعداد زیرزمین", "۰", { type: "number" })}{input("structure", "سیستم سازه‌ای", "مثلاً بتنی")}{input("foundation", "نوع فونداسیون", "مثلاً گسترده")}</div><div className="form-section-title">مبنای قراردادی و برآورد</div><div className="form-grid">{selectField("fundingType", "منبع تأمین مالی", [["private", "خصوصی"], ["public", "عمومی"], ["partnership", "مشارکتی"]])}{selectField("pricingBasis", "مبنای قیمت", [["market", "بازار آزاد"], ["contractor", "اختصاصی پیمانکار"], ["official", "فهرست‌بهای رسمی (با سند پیمان)"]])}{selectField("stage", "مرحله برآورد", Object.entries(stageLabels))}{input("estimateDate", "تاریخ مبنای برآورد", "مثلاً ۱۴۰۴/۰۱/۰۱")}{input("employer", "کارفرما", "اختیاری")}{input("contractor", "پیمانکار", "اختیاری")}{input("contractType", "نوع قرارداد", "اختیاری")}{input("contractReference", "ارجاع به مبنای پیمان", "برای مبنای رسمی الزامی است", { wide: true, required: f("pricingBasis") === "official" })}{areaField("notes", "توضیحات و فرضیات پروژه", "محدودیت‌ها و اطلاعات تکمیلی را اینجا ثبت کنید.")}</div>{f("pricingBasis") === "official" && <div className="form-note"><Info size={17} /> انتخاب مبنای رسمی به‌تنهایی شمول فهرست‌بها را اثبات نمی‌کند؛ ارجاع پیمان و سند تأییدشده لازم است.</div>}</div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy}>{busy ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد پروژه"}</button></div></form>}
      {modal === "takeoff" && <form onSubmit={submitTakeoff}><div className="modal-body"><div className="form-section-title">شناسنامه عملیات</div><div className="form-grid">{input("title", "شرح عملیات", "مثلاً حجم هندسی بتن فونداسیون", { required: true, wide: true })}{input("category", "دسته عملیات", "مثلاً بتن‌ریزی", { required: true })}{selectField("kind", "نوع اندازه‌گیری", Object.entries(kindLabels))}{input("floor", "طبقه", "مثلاً زیرزمین ۱")}{input("location", "محل دقیق اجرا", "مثلاً محور A تا C")}</div><div className="form-section-title">ابعاد و فرمول <span>ورودی‌ها بر حسب متر؛ کسر در واحد خروجی</span></div><div className="form-grid form-grid-measures">{!["count", "weight"].includes(f("kind")) && input("length", "طول (متر)", "مثلاً ۱۲", { required: true })}{["area", "volume"].includes(f("kind")) && input("width", "عرض (متر)", "مثلاً ۸", { required: true })}{f("kind") === "volume" && input("height", "ارتفاع / ضخامت (متر)", "مثلاً ۰٫۵", { required: true })}{f("kind") === "weight" && input("unitWeight", "وزن هر واحد (کیلوگرم)", "مثلاً ۱۵٫۳", { required: true })}{input("count", "تعداد تکرار", "۱", { required: true })}{input("deduction", `کسر صریح (${measurementUnits[f("kind") as MeasurementKind] || "واحد خروجی"})`, "۰")}</div><div className="formula-preview"><span>پیش‌نمایش محاسبه هندسی</span>{quantityPreview ? <div><code dir="ltr">{quantityPreview.formula}</code><strong>{fa(quantityPreview.quantity, 4)} {quantityPreview.unit}</strong></div> : <p>ابعاد معتبر را وارد کنید تا پیش‌نمایش نمایش داده شود.</p>}</div><div className="form-section-title">ردیابی و مستندات</div><div className="form-grid">{selectField("documentId", "فایل منبع", [["", "بدون فایل پیوست"], ...currentDocs.map((d) => [d.id, d.fileName] as [string, string])], true)}{areaField("sourceNote", "منبع اندازه‌گیری / محل روی نقشه", "مثلاً پلان فونداسیون A-03، محور ۱ تا ۳؛ اندازه‌گیری دستی")}{areaField("ruleReference", "ضابطه یا فرض واردشده توسط کاربر (اختیاری)", "بند و صفحه سند را در صورت بررسی وارد کنید.")}{input("duplicateReason", "دلیل ثبت ردیف مشابه (فقط برای تکرار عمدی)", "اگر همین محاسبه قبلاً در پروژه ثبت شده است", { wide: true })}</div><div className="form-note"><Info size={17} /> ردیف ابتدا پیش‌نویس است. پس از بررسی ابعاد و منبع مقدار، آن را در جدول تأیید کنید. تغییر ردیفِ متصل به فهرست‌بها، تطبیق قبلی را جدا می‌کند و بازبینی مجدد می‌خواهد.</div></div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy || !quantityPreview}>{busy ? "در حال محاسبه..." : "ثبت مقدار"}</button></div></form>}
      {modal === "price" && <form onSubmit={submitPrice}><div className="modal-body"><div className="form-grid">{input("title", "شرح بها", "مثلاً اجرای بتن رده مشخص", { required: true, wide: true })}{selectField("basis", "مبنای قیمت", [["market", "بازار آزاد"], ["contractor", "اختصاصی پیمانکار"], ["official", "فهرست‌بهای رسمی"]])}{selectField("unit", "واحد", Object.values(measurementUnits).map((unit) => [unit, unit]))}{input("amount", "بهای واحد", "مبلغ بدون جداکننده", { required: true })}{selectField("currency", "واحد پول", [["IRR", "ریال"], ["IRT", "تومان"]])}{input("code", "شماره ردیف / کد", "برای مبنای رسمی الزامی است")}{input("category", "دسته / فصل", "اختیاری")}{input("sourceName", "نام منبع قیمت", "مثلاً پیش‌فاکتور تأمین‌کننده", { required: true, wide: true })}{input("sourceUrl", "لینک منبع", "https://...")}{input("priceDate", "تاریخ قیمت", "مثلاً ۱۴۰۴/۰۳/۲۱", { required: true })}{input("validUntil", "اعتبار تا", "اختیاری")}{input("supplier", "تأمین‌کننده", "اختیاری")}{input("region", "منطقه جغرافیایی", "اختیاری")}{f("basis") === "official" && selectField("referenceId", "سند فهرست‌بهای تأییدشده", [["", "سند را انتخاب کنید"], ...data.references.filter((r) => r.status === "verified" && r.kind === "pricebook").map((r) => [r.id, r.title] as [string, string])], true)}</div><label className="checkbox-row"><input type="checkbox" checked={form.confirmed === true} onChange={(e) => change("confirmed", e.target.checked)} /><span>منبع و مبلغ را شخصاً بررسی کرده‌ام و این قیمت را برای استفاده تأیید می‌کنم.</span></label><div className="form-note"><Info size={17} /> این قیمت دستی است. مبلغ رسمی فقط با سند فهرست‌بهای بازبینی‌شده و مبنای پیمان قابل استفاده است.</div></div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy}>{busy ? "در حال ذخیره..." : "ذخیره بهای واحد"}</button></div></form>}
      {modal === "reference" && <form onSubmit={submitReference}><div className="modal-body"><div className="form-grid">{input("title", "عنوان کامل سند", "مثلاً عنوان دقیق سند ابلاغ‌شده", { required: true, wide: true })}{selectField("kind", "نوع سند", Object.entries(refLabels))}{input("issuer", "مرجع صادرکننده", "نام نهاد صادرکننده", { required: true })}{input("documentNumber", "شماره بخشنامه / سند", "در صورت وجود")}{input("issueDate", "تاریخ ابلاغ", "مثلاً ۱۴۰۴/۰۱/۰۱")}{input("effectiveDate", "تاریخ اجرا", "مثلاً ۱۴۰۴/۰۱/۰۱")}{input("basePeriod", "سال یا دوره مبنا", "اختیاری")}{input("url", "لینک نسخه مرجع", "https://...", { wide: true })}{areaField("scope", "دامنه شمول", "نوع پروژه، قرارداد و بازه زمانی مشمول را دقیق ثبت کنید.")}{areaField("amendments", "اصلاحیه‌ها و الحاقات", "شماره و تاریخ اصلاحیه‌های بررسی‌شده")}{input("replacement", "سند جایگزین", "در صورت منسوخ شدن", { wide: true })}{areaField("notes", "یادداشت بازبینی", "روش تطبیق با نسخه منتشرشده")}</div><div className="form-note"><ShieldCheck size={17} /> سند تا زمان تکمیل اطلاعات و تأیید دستی شما در وضعیت «بررسی‌نشده» باقی می‌ماند.</div></div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy}>{busy ? "در حال ذخیره..." : "ثبت سند"}</button></div></form>}
      {modal === "document" && <form onSubmit={submitDocument}><div className="modal-body"><label className="upload-drop"><UploadCloud size={30} /><strong>{uploadFile ? uploadFile.name : "فایل را انتخاب کنید"}</strong><span>PDF، PNG یا JPG تا ۳ مگابایت</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} required /></label><div className="form-grid">{input("version", "شناسه نسخه", "نسخه ۱")}{input("description", "توضیح فایل", "مثلاً پلان معماری طبقه همکف")}</div><div className="form-note"><LockKeyhole size={17} /> تنها مالک این فضای کار به فایل دسترسی دارد. فایل‌های DWG/IFC در این نسخه پشتیبانی نمی‌شوند.</div></div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy || !uploadFile}>{busy ? "در حال بارگذاری..." : "بارگذاری فایل"}</button></div></form>}
      {modal === "auth" && <form onSubmit={submitAuth}><div className="modal-body"><div className="auth-tabs"><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>ثبت‌نام</button><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>ورود</button></div><div className="form-grid">{authMode === "register" && input("name", "نام شما", "نام و نام خانوادگی", { required: true, wide: true })}{input("email", "ایمیل", "name@example.com", { required: true, wide: true, type: "email" })}{input("password", "رمز عبور", "حداقل ۱۰ نویسه", { required: true, wide: true, type: "password" })}</div>{data.user.isGuest && authMode === "register" && <div className="form-note"><Info size={17} /> با ساخت حساب، پروژه‌های این فضای مهمان به حساب شما منتقل و حفظ می‌شوند.</div>}{!data.user.isGuest && <button type="button" className="logout-link" onClick={async () => { const result = await mutate("/api/auth", "POST", { action: "logout" }, "از حساب خارج شدید."); if (result) { setModal(null); setSelectedId(""); preference.remove("metra_project"); } }}>خروج از حساب فعلی</button>}</div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-primary" disabled={busy}>{authMode === "register" ? "ساخت حساب" : "ورود"}</button></div></form>}
      {modal === "deleteProject" && selected && <form onSubmit={async (event) => { event.preventDefault(); const result = await mutate("/api/projects", "DELETE", { id: selected.id, confirmName: f("confirmName") }, "پروژه و داده‌های مرتبط حذف شدند."); if (result) { setModal(null); setSelectedId(""); preference.remove("metra_project"); } }}><div className="modal-body"><div className="delete-warning"><Trash2 size={22} /><strong>این عملیات برگشت‌پذیر نیست.</strong><p>متره‌ها، اسناد و نسخه‌های برآورد این پروژه حذف می‌شوند. برای نگهداری تاریخچه، به‌جای آن از بایگانی استفاده کنید.</p></div>{input("confirmName", `نام دقیق پروژه «${selected.name}» را بنویسید`, "تأیید حذف", { required: true, wide: true })}</div><div className="modal-footer"><button type="button" className="button button-outline" onClick={() => setModal(null)}>انصراف</button><button className="button button-danger" disabled={busy || f("confirmName") !== selected.name}>حذف همیشگی پروژه</button></div></form>}
    </section></div>}
    {calc && <RuleCalculator bank={data.ruleBank} initialRef={calc.ref} row={calc.row ?? null} project={selected ? { id: selected.id, name: selected.name, isDemo: selected.isDemo, estimateDate: selected.estimateDate } : null} documents={currentDocs} onClose={() => setCalc(null)} onSaved={async (message) => { await refresh(true); setToast(message); }} />}
    {matchRow && <MatchDialog row={matchRow} onClose={() => setMatchRow(null)} onChanged={() => refresh(true)} notify={setToast} />}
    {scenarioReview && <CoefficientScenarioModal directTotal={scenarioReview.directTotal} busy={busy}
      stale={selected?.id !== scenarioReview.projectId || !preview || preview.reviewHash !== scenarioReview.reviewHash || !!preview.issues.length}
      onClose={() => setScenarioReview(null)} onSave={async (factors) => {
        const result = await mutate("/api/estimates", "POST", { projectId: scenarioReview.projectId, notes: f("estimateNotes"),
          coefficientScenario: { factors, attestScope: true, expectedReviewHash: scenarioReview.reviewHash } }, "نسخه همراه سناریوی دستی ثبت شد.");
        if (result) { setScenarioReview(null); setForm((old) => ({ ...old, estimateNotes: "" })); }
      }} />}
    {fallbackReport && <FallbackReport url={fallbackReport} onClose={() => setFallbackReport(null)} />}
    {toast && <div className="toast"><Info size={18} /><span>{toast}</span><button onClick={() => setToast("")}><X size={16} /></button></div>}
  </div>;
}
