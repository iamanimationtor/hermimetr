"use client";

import { useEffect, useState } from "react";
import { Archive, BookOpen, Check, CircleAlert, Info, Link2, ListChecks, Plus, Search, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import type { MatchSuggestion } from "@/lib/pricebook/match";
import type { ReferenceLite } from "@/components/rules-view";
import { Badge, callApi, Empty, fa, Modal, PanelTitle } from "@/components/ui";
import { OFFICIAL_PUBLISHERS } from "@/lib/pricebook/publisher-registry";
import { MAX_JSON_BYTES, MAX_PRICEBOOK_FILE_BYTES } from "@/lib/limits";

export type SyncState = { id: string; editionId: string | null; referenceId: string | null; sourceUrl: string | null; lastCheckedAt: string | null; lastRemoteHash: string | null; lastRemoteModified: string | null; etag: string | null; updateAvailable: boolean; autoCheckEnabled: boolean; lastError: string | null };
export type PricebookEdition = {
  id: string; title: string; discipline: string; baseYear: string; referenceId: string | null; status: string; notes: string | null; createdAt: string; itemCount: number;
};
type Item = { id: string; code: string; chapterCode: string | null; chapterTitle: string | null; description: string; unit: string; unitPriceRial: string | null; conditions: string | null; page: string | null };
type Listing = { items: Item[]; total: number; chapters: string[] };
type Notify = (message: string) => void;

const STATUS: Record<string, { label: string; tone: "neutral" | "green" | "orange" }> = {
  draft: { label: "پیش‌نویس", tone: "orange" }, active: { label: "فعال", tone: "green" }, archived: { label: "بایگانی", tone: "neutral" },
};
const TEMPLATE = "code,chapterCode,chapterTitle,description,unit,price,conditions,page";

export function PricebookView({ editions, references, syncStates, onChanged, notify, onOpenReferences }: {
  editions: PricebookEdition[]; references: ReferenceLite[]; syncStates?: SyncState[]; onChanged: () => Promise<unknown>; notify: Notify; onOpenReferences: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [modal, setModal] = useState<"create" | "import" | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = editions.find((edition) => edition.id === selectedId) ?? editions[0];
  const currentId = selected?.id ?? "";
  const itemCount = selected?.itemCount ?? 0;
  const pricebookReferences = references.filter((reference) => reference.kind === "pricebook");

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    const params = new URLSearchParams({ editionId: currentId, q: query, chapter });
    void callApi<Listing>(`/api/pricebook?${params.toString()}`).then((response) => {
      if (!cancelled && response.ok) setListing({ items: response.data.items ?? [], total: response.data.total ?? 0, chapters: response.data.chapters ?? [] });
    });
    return () => { cancelled = true; };
  }, [currentId, query, chapter, itemCount]);

  const act = async (body: Record<string, unknown>, success: string, method: "POST" | "DELETE" = "POST") => {
    setBusy(true);
    const response = await callApi("/api/pricebook", method, body);
    setBusy(false);
    if (!response.ok) { notify(response.data.error ?? "عملیات انجام نشد."); return false; }
    await onChanged();
    notify(success);
    return true;
  };
  const referenceOf = (edition: PricebookEdition) => references.find((reference) => reference.id === edition.referenceId);

  return <>
    <div className="page-intro"><div>
      <div className="eyebrow">بانک رسمی <span className="eyebrow-divider">/</span> نسخه‌دار و وابسته به سند</div>
      <h1>فهرست‌بها</h1>
      <p>ردیف‌های رسمی را خودتان از سند معتبر وارد می‌کنید؛ سامانه هیچ ردیف، مبلغ یا ضریبی را از پیش ندارد.</p>
    </div><button className="button button-primary" onClick={() => setModal("create")}><Plus size={18} /> نسخه جدید فهرست‌بها</button></div>
    <div className="info-banner"><div><ShieldCheck size={19} /></div><p>هر نسخه تا زمانی که به سند فهرست‌بهای «بازبینی‌شده» در دامنه سازمان برنامه‌وبودجه متصل نباشد، فعال نمی‌شود و در تطبیق و برآورد به‌کار نمی‌رود. نسخه فعال دیگر تغییر نمی‌کند تا برآوردهای گذشته ثابت بمانند.</p></div>
    <HybridBankIntro />
    <PricebookSyncPanel editions={editions} references={references} syncStates={syncStates ?? []} onChanged={onChanged} notify={notify} />

    {editions.length ? <div className="edition-grid">{editions.map((edition) => {
      const reference = referenceOf(edition);
      const status = STATUS[edition.status] ?? STATUS.draft;
      return <article key={edition.id} className={`panel edition-card ${selected?.id === edition.id ? "active" : ""}`} data-edition={edition.title}>
        <button className="edition-main" onClick={() => { setSelectedId(edition.id); setQuery(""); setChapter(""); }}>
          <div className="edition-top"><span className="edition-icon"><ListChecks size={20} /></span><Badge tone={status.tone}>{status.label}</Badge></div>
          <h3>{edition.title}</h3>
          <p>{edition.discipline} · سال مبنا {edition.baseYear} · {fa(edition.itemCount)} ردیف</p>
          <div className="edition-ref">{reference
            ? <><BookOpen size={14} /><span>{reference.title}</span><Badge tone={reference.status === "verified" ? "green" : "orange"}>{reference.status === "verified" ? "سند بازبینی‌شده" : "سند تأییدنشده"}</Badge></>
            : <><CircleAlert size={14} /><span>سند مرجع متصل نشده است</span></>}</div>
        </button>
        <div className="edition-actions">
          {edition.status === "draft" && <>
            <button className="button button-soft button-sm" onClick={() => { setSelectedId(edition.id); setModal("import"); }}><UploadCloud size={15} /> ورود ردیف‌ها</button>
            {!reference && <select className="inline-select" aria-label="اتصال سند مرجع" value="" onChange={(event) => { if (event.target.value) void act({ action: "linkReference", editionId: edition.id, referenceId: event.target.value }, "سند مرجع به نسخه متصل شد."); }}>
              <option value="">اتصال سند مرجع...</option>{pricebookReferences.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
          </>}
          {edition.status !== "active" && <button className="button button-outline button-sm" disabled={busy} onClick={() => void act({ action: "setStatus", editionId: edition.id, status: "active" }, "نسخه فعال شد و در تطبیق قابل استفاده است.")}><Check size={15} /> فعال‌سازی</button>}
          {edition.status === "active" && <button className="button button-outline button-sm" disabled={busy} onClick={() => void act({ action: "setStatus", editionId: edition.id, status: "archived" }, "نسخه بایگانی شد.")}><Archive size={15} /> بایگانی</button>}
          {edition.status !== "active" && <button className="icon-remove" title="حذف نسخه" onClick={() => { if (window.confirm(`نسخه «${edition.title}» و ردیف‌های آن حذف شود؟`)) void act({ editionId: edition.id }, "نسخه حذف شد.", "DELETE"); }}><Trash2 size={16} /></button>}
        </div>
      </article>;
    })}</div> : <section className="panel"><Empty icon={ListChecks} title="هنوز نسخه‌ای از فهرست‌بها ثبت نشده است"
      description="ابتدا سند فهرست‌بها را در «منابع مرجع» ثبت و تأیید کنید، سپس یک نسخه بسازید و ردیف‌ها را از فایل CSV یا Excel وارد کنید."
      action={<div className="empty-actions"><button className="button button-primary" onClick={() => setModal("create")}>ایجاد نسخه</button><button className="button button-outline" onClick={onOpenReferences}>رفتن به منابع مرجع</button></div>} /></section>}

    {selected && <section className="panel table-panel pricebook-items">
      <div className="table-toolbar"><div><h3>ردیف‌های «{selected.title}»</h3><p>{fa(listing?.total ?? 0)} ردیف با فیلتر فعلی · حداکثر ۱۰۰ ردیف نمایش داده می‌شود</p></div>
        <div className="table-tools">
          <select className="inline-select wide" aria-label="فیلتر فصل" value={chapter} onChange={(event) => setChapter(event.target.value)}>
            <option value="">همه فصل‌ها</option>{(listing?.chapters ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <div className="filter-search compact"><Search size={16} /><input placeholder="کد یا شرح ردیف..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        </div></div>
      {listing?.items.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>کد</th><th>فصل</th><th>شرح ردیف</th><th>واحد</th><th>بهای واحد (ریال)</th><th>شرایط کاربرد</th></tr></thead><tbody>
        {listing.items.map((item) => <tr key={item.id}>
          <td><code className="mono">{item.code}</code></td><td>{item.chapterTitle || "—"}{item.chapterCode && <small className="table-sub">فصل {item.chapterCode}</small>}</td>
          <td className="wrap-cell">{item.description}{item.page && <small className="table-sub">صفحه {item.page}</small>}</td><td>{item.unit}</td>
          <td className="money-cell">{item.unitPriceRial ? fa(item.unitPriceRial) : <span className="muted">بدون بها</span>}</td><td className="wrap-cell">{item.conditions || "—"}</td>
        </tr>)}
      </tbody></table></div> : <Empty icon={ListChecks} title={selected.itemCount ? "ردیفی با این فیلتر پیدا نشد" : "این نسخه هنوز ردیفی ندارد"}
        description={selected.itemCount ? "عبارت جست‌وجو یا فصل را تغییر دهید." : "ردیف‌ها را از فایل CSV یا Excel که از سند رسمی تهیه کرده‌اید وارد کنید."}
        action={selected.status === "draft" && !selected.itemCount ? <button className="button button-primary" onClick={() => setModal("import")}>ورود ردیف‌ها</button> : undefined} />}
    </section>}

    {modal === "create" && <CreateEdition references={pricebookReferences} onClose={() => setModal(null)} onOpenReferences={onOpenReferences}
      onCreate={async (body) => { if (await act({ action: "createEdition", ...body }, "نسخه پیش‌نویس ساخته شد.")) setModal(null); }} busy={busy} />}
    {modal === "import" && selected && <ImportRows edition={selected} onClose={() => setModal(null)} onDone={async (count) => { await onChanged(); notify(`${fa(count)} ردیف وارد شد.`); setModal(null); }} />}
  </>;
}

function HybridBankIntro() {
  return <section className="panel hybrid-intro"><PanelTitle title="بانک قیمت یکپارچه — هیبرید" subtitle="فهرست‌بها رسمی با به‌روزرسانی خودکار · قیمت‌های بازار/پیمانکار به‌صورت دستی با منبع و تاریخ" />
    <div className="hybrid-grid">
      <div className="hybrid-card official"><div className="hybrid-badge green">خودکار</div><h4>فهرست‌بها رسمی</h4><p>نسخه‌دار از منابع مجاز (mporg.ir). بررسی خودکار تغییرات با هش/ETag و اعلان نسخه جدید؛ هیچ ردیفی بدون تأیید شما جایگزین نمی‌شود. محاسبه هزینه به‌صورت یکپارچه و دقیق با مقدار متره انجام می‌شود.</p><small>منابع مجاز: {OFFICIAL_PUBLISHERS.map(p=>p.host).join(" · ")}</small></div>
      <div className="hybrid-card manual"><div className="hybrid-badge orange">دستی</div><h4>بازار آزاد / اختصاصی پیمانکار</h4><p>ورود دستی همچنان حفظ شده است: هر بها با واحد، مبلغ، منبع، تاریخ و تأیید انسانی. برای راحت‌ترین استفاده، همان گزینه‌ها به‌صورت خودکار در انتخاب بهای ردیف متره ظاهر می‌شوند.</p><small>هیچ قیمت بازار به‌صورت خودکار حدس زده نمی‌شود.</small></div>
    </div>
    <div className="hybrid-flow"><span>۱. سند رسمی ثبت</span><span className="arrow">←</span><span>۲. نسخه + بررسی خودکار</span><span className="arrow">←</span><span>۳. تطبیق تأییدشده</span><span className="arrow">←</span><span>۴. محاسبه دقیق خودکار</span></div>
  </section>;
}

function PricebookSyncPanel({ editions, references, syncStates, onChanged, notify }: { editions: PricebookEdition[]; references: ReferenceLite[]; syncStates: SyncState[]; onChanged: () => Promise<unknown>; notify: Notify }) {
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; messageFa: string; detailFa?: string; updateAvailable?: boolean }>>({});
  const syncOf = (edition: PricebookEdition) => syncStates.find(s=> s.editionId === edition.id) ?? null;
  const check = async (edition: PricebookEdition) => {
    setChecking(edition.id);
    try {
      const r = await callApi<{ check: { ok: boolean; messageFa: string; detailFa?: string; updateAvailable?: boolean } }>(`/api/pricebook/sync?editionId=${edition.id}`);
      if (r.ok) setResults((prev) => ({ ...prev, [edition.id]: r.data.check }) as any);
      else setResults((prev) => ({ ...prev, [edition.id]: { ok: false, messageFa: (r.data as any).error ?? "بررسی ناموفق بود." }} as any));
      await onChanged();
    } finally { setChecking(null); }
  };
  if (!editions.length) return null;
  return <section className="panel sync-panel"><PanelTitle title="به‌روزرسانی خودکار از منابع معتبر" subtitle="بررسی هش/تاریخ منبع رسمی — بدون بازنویسی خودکار قیمت‌ها" />
    <div className="sync-list">
      {editions.map(ed=>{
        const ref = references.find(r=> r.id===ed.referenceId);
        const sync = syncOf(ed);
        const res = results[ed.id];
        return <div key={ed.id} className="sync-row">
          <div className="sync-main"><strong>{ed.title}</strong><small>{ed.discipline} · {ed.baseYear} · {ref ? ref.title : "بدون سند"} {ref?.url ? `· ${ref.url}` : ""}</small>
            {sync?.lastCheckedAt && <small>آخرین بررسی: {new Date(sync.lastCheckedAt).toLocaleString("fa-IR")} {sync.updateAvailable ? "· نسخه جدید احتمالی" : sync.lastError ? `· خطا: ${String(sync.lastError).slice(0,60)}` : "· بدون تغییر"}</small>}
            {res && <div className={res.ok ? (res.updateAvailable ? "sync-warn" : "sync-ok") : "sync-err"}>{res.messageFa} {res.detailFa ? `— ${res.detailFa}` : ""}</div>}
          </div>
          <div className="sync-actions">
            <button className="button button-outline button-sm" disabled={!!checking} onClick={()=> void check(ed)}>{checking===ed.id ? "در حال بررسی..." : "بررسی به‌روزرسانی"}</button>
            {res?.updateAvailable && <span className="badge-update">نسخه جدید — با ورود فایل جدید تأیید کنید</span>}
          </div>
        </div>;
      })}
    </div>
    <div className="sync-note"><Info size={14} /> هیچ بهای فعال خودکار بازنویسی نمی‌شود. در صورت شناسایی تغییر، نسخه جدید را به‌صورت پیش‌نویس بسازید و فایل رسمی تازه را بارگذاری و فعال کنید؛ برآورد همه پروژه‌ها سپس به‌صورت یکپارچه با بهای دقیق جدید محاسبه می‌شود.</div>
  </section>;
}

function CreateEdition({ references, busy, onClose, onCreate, onOpenReferences }: {
  references: ReferenceLite[]; busy: boolean; onClose: () => void; onCreate: (body: Record<string, unknown>) => Promise<void>; onOpenReferences: () => void;
}) {
  const [form, setForm] = useState({ title: "", discipline: "ابنیه", baseYear: "", referenceId: "", notes: "" });
  return <Modal eyebrow="بانک فهرست‌بها" title="نسخه جدید فهرست‌بها" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={onClose}>انصراف</button>
    <button type="button" className="button button-primary" disabled={busy || !form.title.trim() || !form.discipline.trim() || !form.baseYear.trim()}
      onClick={() => void onCreate({ ...form, referenceId: form.referenceId || null })}>ایجاد نسخه پیش‌نویس</button>
  </>}>
    <div className="form-grid">
      <label className="form-field wide"><span>عنوان نسخه<em>*</em></span><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="مثلاً فهرست‌بهای واحد پایه رشته ابنیه" /></label>
      <label className="form-field"><span>رشته<em>*</em></span><input className="input" value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value })} /></label>
      <label className="form-field"><span>سال مبنا<em>*</em></span><input className="input" value={form.baseYear} onChange={(event) => setForm({ ...form, baseYear: event.target.value })} placeholder="مثلاً ۱۴۰۴" /></label>
      <label className="form-field wide"><span>سند مرجع (از منابع مرجع، نوع فهرست‌بها)</span><select className="input" value={form.referenceId} onChange={(event) => setForm({ ...form, referenceId: event.target.value })}>
        <option value="">بعداً متصل می‌کنم</option>{references.map((reference) => <option key={reference.id} value={reference.id}>{reference.title} — {reference.status === "verified" ? "بازبینی‌شده" : "تأییدنشده"}</option>)}</select>
        {!references.length && <small>سندی از نوع فهرست‌بها ثبت نشده است. <button type="button" className="text-link" onClick={onOpenReferences}>ثبت سند</button></small>}</label>
      <label className="form-field wide"><span>یادداشت</span><textarea className="input" rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="منبع فایل، روش استخراج و کنترل" /></label>
    </div>
    <div className="form-note"><Info size={17} /> نسخه در وضعیت پیش‌نویس ساخته می‌شود. فعال‌سازی فقط با سند فهرست‌بهای بازبینی‌شده در دامنه mporg.ir ممکن است.</div>
  </Modal>;
}

function ImportRows({ edition, onClose, onDone }: { edition: PricebookEdition; onClose: () => void; onDone: (count: number) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [review, setReview] = useState<{ body: { action: string; editionId: string; format: "csv" | "xlsx"; content: string }; count: number; skippedEmpty: number; sample: Array<{ code: string; description: string; unit: string; unitPriceRial: string | null; conditions: string | null; chapterTitle: string | null; page: string | null }> } | null>(null);
  const submit = async () => {
    setBusy(true); setErrors([]);
    try {
      if (review) {
        const response = await callApi<{ imported: number }>("/api/pricebook", "POST", review.body);
        if (!response.ok) { setErrors(response.data.errors?.length ? response.data.errors : [response.data.error ?? "ورود انجام نشد."]); return; }
        await onDone(response.data.imported ?? 0);
        return;
      }
      let format: "csv" | "xlsx" = "csv";
      let content = text;
      if (file) {
        if (file.size > MAX_PRICEBOOK_FILE_BYTES) { setErrors(["حجم فایل نباید از ۲٫۸ مگابایت بیشتر باشد."]); return; }
        if (/\.xlsx$/i.test(file.name)) {
          format = "xlsx";
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(start, start + 0x8000)));
          content = btoa(binary);
        } else content = await file.text();
      }
      const body = { action: "import", editionId: edition.id, format, content };
      if (new TextEncoder().encode(JSON.stringify({ ...body, preview: true })).byteLength > MAX_JSON_BYTES) {
        setErrors(["حجم درخواست بیش از حد مجاز است؛ فایل یا متن را به بخش‌های کوچک‌تر تقسیم کنید."]); return;
      }
      const response = await callApi<{ count: number; skippedEmpty: number; sample: NonNullable<typeof review>["sample"] }>("/api/pricebook", "POST", { ...body, preview: true });
      if (!response.ok) { setErrors(response.data.errors?.length ? response.data.errors : [response.data.error ?? "کنترل فایل انجام نشد."]); return; }
      if (response.data.count === undefined || response.data.skippedEmpty === undefined || !response.data.sample) throw new Error("Invalid preview response");
      setReview({ body, count: response.data.count, skippedEmpty: response.data.skippedEmpty, sample: response.data.sample });
    } catch {
      setErrors(["خواندن فایل یا ارتباط با سرور ناموفق بود؛ دوباره تلاش کنید."]);
    } finally { setBusy(false); }
  };
  return <Modal eyebrow="بانک فهرست‌بها" title={`ورود ردیف‌ها به «${edition.title}»`} size="lg" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={review ? () => { setReview(null); setErrors([]); } : onClose}>{review ? "بازگشت و اصلاح" : "انصراف"}</button>
    <button type="button" className="button button-primary" data-testid="import-submit" disabled={busy || (!file && !text.trim())} onClick={() => void submit()}>{busy ? "در حال پردازش..." : review ? "تأیید و ورود ردیف‌ها" : "کنترل و پیش‌نمایش"}</button>
  </>}>
    <div className="form-note top"><Info size={17} /> فایل باید از سند رسمی تهیه شده باشد. همه سطرها ابتدا کنترل می‌شوند و در صورت وجود حتی یک خطا، هیچ ردیفی وارد نمی‌شود.</div>
    {!review && <><label className="upload-drop"><UploadCloud size={28} /><strong>{file ? file.name : "فایل CSV یا Excel را انتخاب کنید"}</strong><span>ستون‌های الزامی: کد، شرح، واحد · حداکثر ۲۰٬۰۰۰ ردیف و ۲٫۸ مگابایت</span>
      <input type="file" accept=".csv,.xlsx,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <label className="form-field"><span>یا متن CSV را اینجا بچسبانید</span>
      <textarea className="input mono" dir="ltr" rows={6} data-testid="import-text" value={text} onChange={(event) => setText(event.target.value)} placeholder={`${TEMPLATE}\n...`} disabled={!!file} /></label>
    <p className="import-hint">سطر عنوان می‌تواند فارسی یا انگلیسی باشد: <bdi className="mono">{TEMPLATE}</bdi> یا «کد، کد فصل، عنوان فصل، شرح، واحد، بهای واحد، شرایط، صفحه». بهای واحد به ریال و حداکثر با دو رقم اعشار. در CSV متنی که جداکننده دارد را داخل نقل‌قول بگذارید؛ در Excel کدهای دارای صفر ابتدایی را متنی ذخیره کنید و فرمول‌ها را به مقدار ثابت تبدیل کنید.</p></>}
    {review && <div data-testid="import-review"><div className="form-note"><Info size={17} /> {fa(review.count)} ردیف آماده ورود است؛ {fa(review.skippedEmpty)} سطر خالی نادیده گرفته شد. در ادامه حداکثر ۱۰ ردیف نخست نمایش داده شده‌اند. همه ردیف‌ها، سال، واحد ریال و سند منبع را مستقل بررسی کنید؛ کنترل ساختاری به معنی تأیید اصالت یا صحت فهرست نیست.</div><div className="table-scroll"><table className="data-table"><thead><tr><th>کد</th><th>فصل / صفحه</th><th>شرح</th><th>واحد</th><th>بها (ریال)</th><th>شرایط</th></tr></thead><tbody>{review.sample.map((row) => <tr key={row.code}><td>{row.code}</td><td>{row.chapterTitle || "—"} / {row.page || "—"}</td><td>{row.description}</td><td>{row.unit}</td><td>{row.unitPriceRial === null ? "ندارد" : fa(row.unitPriceRial)}</td><td>{row.conditions || "—"}</td></tr>)}</tbody></table></div></div>}
    {errors.length > 0 && <div className="error-box list"><strong><CircleAlert size={16} /> فایل پذیرفته نشد</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
  </Modal>;
}

/* ───────────────────────────── Match dialog ───────────────────────────── */

type SuggestionRow = MatchSuggestion & { editionTitle: string; baseYear: string };
type MatchData = { suggestions: SuggestionRow[]; blockers: string[]; searched: number };

export function MatchDialog({ row, onClose, onChanged, notify }: {
  row: { id: string; title: string; category: string; unit: string; quantity: string; pricebookItemId: string | null };
  onClose: () => void; onChanged: () => Promise<unknown>; notify: Notify;
}) {
  const [data, setData] = useState<MatchData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void callApi<MatchData>(`/api/pricebook?suggestFor=${row.id}`).then((response) => {
      if (cancelled) return;
      if (!response.ok) setLoadError(response.data.error ?? "پیشنهادها بارگذاری نشد.");
      else setData({ suggestions: response.data.suggestions ?? [], blockers: response.data.blockers ?? [], searched: response.data.searched ?? 0 });
    });
    return () => { cancelled = true; };
  }, [row.id]);
  const confirm = async () => {
    setBusy(true); setError("");
    const response = await callApi("/api/pricebook", "POST", { action: "confirmMatch", takeoffId: row.id, itemId: choice, attest });
    setBusy(false);
    if (!response.ok) { setError(response.data.error ?? "تطبیق ثبت نشد."); return; }
    await onChanged();
    notify("تطبیق تأیید شد و بهای رسمی به ردیف متره متصل شد.");
    onClose();
  };
  const blocked = (data?.blockers.length ?? 0) > 0;
  return <Modal eyebrow="تطبیق با فهرست‌بها" title="پیشنهاد ردیف فهرست‌بها" size="lg" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={onClose}>بستن</button>
    <button type="button" className="button button-primary" data-testid="match-confirm" disabled={busy || blocked || !choice || !attest} onClick={() => void confirm()}>{busy ? "در حال ثبت..." : "تأیید تطبیق انتخاب‌شده"}</button>
  </>}>
    <div className="match-subject"><Link2 size={18} /><div><strong>{row.title}</strong><span>{row.category} · {fa(row.quantity, 4)} {row.unit}</span></div></div>
    <div className="form-note top"><Info size={17} /> این فهرست فقط «پیشنهاد» است. امتیاز از یکسانی واحد، هم‌پوشانی عملیات با فصل، واژه‌های شرح و مشخصات عددی ساخته می‌شود و جای کنترل شرح کامل ردیف و مقدمه فصل در سند رسمی را نمی‌گیرد.</div>
    {loadError && <div className="error-box"><CircleAlert size={16} /> {loadError}</div>}
    {data?.blockers.map((blocker) => <div className="warn-box" key={blocker}><CircleAlert size={16} /> {blocker}</div>)}
    {!data && !loadError && <p className="muted">در حال جست‌وجو در نسخه‌های فعال...</p>}
    {data && !data.suggestions.length && <Empty icon={ListChecks} title="پیشنهادی پیدا نشد" description={data.searched ? `در ${fa(data.searched)} ردیف نسخه‌های فعال، ردیفی با هم‌پوشانی عملیاتی یافت نشد. شرح ردیف متره را دقیق‌تر کنید یا ردیف را دستی در بانک قیمت ثبت کنید.` : "نسخه فعالی از فهرست‌بها برای جست‌وجو وجود ندارد."} />}
    <div className="match-list">{data?.suggestions.map((suggestion) => <label key={suggestion.item.id} className={`match-card ${choice === suggestion.item.id ? "chosen" : ""} ${suggestion.confirmable ? "" : "disabled"}`}>
      <div className="match-head">
        <input type="radio" name="match" disabled={!suggestion.confirmable || blocked} checked={choice === suggestion.item.id} onChange={() => setChoice(suggestion.item.id)} />
        <code className="mono">{suggestion.item.code}</code>
        <span className="match-edition">{suggestion.editionTitle} · {suggestion.baseYear}</span>
        <span className="score"><i style={{ width: `${suggestion.score}%` }} /><b>{fa(suggestion.score)} از ۱۰۰</b></span>
      </div>
      <p className="match-description">{suggestion.item.description}</p>
      <div className="match-facts"><span>واحد: <b>{suggestion.item.unit}</b></span><span>بهای واحد: <b>{suggestion.item.unitPriceRial ? `${fa(suggestion.item.unitPriceRial)} ریال` : "ندارد"}</b></span>
        <span>واحد {fa(suggestion.breakdown.unit)}/۳۰</span><span>عملیات {fa(suggestion.breakdown.operation)}/۲۰</span><span>شرح {fa(suggestion.breakdown.terms)}/۳۵</span><span>مشخصات عددی {fa(suggestion.breakdown.numbers)}/۱۵</span></div>
      <ul className="match-reasons">{suggestion.reasons.map((reason) => <li key={reason} className="ok"><Check size={13} /> {reason}</li>)}
        {suggestion.cautions.map((caution) => <li key={caution} className="warn"><CircleAlert size={13} /> {caution}</li>)}
        {suggestion.distinctTerms.length > 0 && <li className="diff">واژه‌های این ردیف که در شرح متره نیست: {suggestion.distinctTerms.join("، ")}</li>}</ul>
    </label>)}</div>
    {data && data.suggestions.length > 0 && <label className="checkbox-row"><input type="checkbox" checked={attest} onChange={(event) => setAttest(event.target.checked)} />
      <span>شرح کامل ردیف، شرایط کاربرد و مقدمه فصل را در سند رسمی کنترل کرده‌ام و مسئولیت این تطبیق را می‌پذیرم.</span></label>}
    {error && <div className="error-box"><CircleAlert size={16} /> {error}</div>}
  </Modal>;
}
