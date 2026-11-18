"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, FileText, LockKeyhole, Trash2 } from "lucide-react";
import { sessionFetch } from "@/lib/client-session";
import { fa } from "@/components/ui";

type SnapshotOption = { id: string; version: number; projectId: string; projectName?: string; totalRial: string; rows: unknown[]; createdAt: string; basis: string };
type ProgressRow = { takeoffId: string; title: string; unit: string; estimatedQuantity: string; unitPriceRial: string; previousQuantity: string; currentQuantity: string; periodQuantity: string; previousAmountRial: string; cumulativeAmountRial: string; periodAmountRial: string; evidence: string };
type ProgressTotals = { previousRial: string; cumulativeRial: string; periodRial: string; baselineRial: string };
type ProgressReport = { id: string; snapshotId: string; sequence: number; period: string; rows: ProgressRow[]; totals: ProgressTotals; actorId: string; notes: string | null; voidedAt: string | null; voidReason: string | null; createdAt: string };

function persianToAscii(value: string) {
  return value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").trim();
}

export function ProgressView({ snapshots, selectedProjectId, notify }: { snapshots: SnapshotOption[]; selectedProjectId?: string; notify: (msg: string) => void }) {
  const [snapshotId, setSnapshotId] = useState<string>("");
  const resolvedSnapshotId = useMemo(() => {
    if (snapshotId) return snapshotId;
    const forProject = snapshots.filter((s) => !selectedProjectId || s.projectId === selectedProjectId).sort((a, b) => b.version - a.version);
    return forProject[0]?.id || "";
  }, [snapshotId, snapshots, selectedProjectId]);

  const [data, setData] = useState<{ snapshot: SnapshotOption; reports: ProgressReport[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("");
  const [notes, setNotes] = useState("");
  const [inputs, setInputs] = useState<Record<string, { currentQuantity: string; evidence: string }>>({});
  const [attest, setAttest] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredSnapshots = snapshots.filter((s) => !selectedProjectId || s.projectId === selectedProjectId);

  useEffect(() => {
    if (!resolvedSnapshotId) return;
    let cancelled = false;
    setLoading(true); setError("");
    sessionFetch(`/api/progress?snapshotId=${resolvedSnapshotId}`, { cache: "no-store" }).then((r) => r.json()).then((body) => {
      if (cancelled) return;
      if (body.error) setError(body.error);
      else {
        setData(body);
        // initialize inputs from active report + estimated
        const active = [...(body.reports as ProgressReport[])].filter((r) => !r.voidedAt).sort((a, b) => b.sequence - a.sequence)[0];
        const rows = (body.snapshot.rows as unknown as { takeoffId: string; quantity: string; title: string; unit: string }[]) || [];
        const next: Record<string, { currentQuantity: string; evidence: string }> = {};
        for (const row of rows) {
          const prev = active?.rows.find((x) => x.takeoffId === row.takeoffId);
          next[row.takeoffId] = { currentQuantity: prev ? prev.currentQuantity : "0.0000", evidence: "" };
        }
        setInputs(next); setAttest(false);
      }
    }).catch(() => !cancelled && setError("دریافت اطلاعات ناموفق بود.")).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [resolvedSnapshotId]);

  const activeReport = data ? [...data.reports].filter((r) => !r.voidedAt).sort((a, b) => b.sequence - a.sequence)[0] ?? null : null;
  const latest = data ? [...data.reports].sort((a, b) => b.sequence - a.sequence)[0] ?? null : null;
  const expectedSequence = latest?.sequence ?? 0;
  const expectedActiveId = activeReport?.id ?? null;

  async function submit() {
    if (!data) return;
    const rows = (data.snapshot.rows as unknown as { takeoffId: string }[]).map((r) => ({
      takeoffId: r.takeoffId,
      currentQuantity: persianToAscii(inputs[r.takeoffId]?.currentQuantity || ""),
      evidence: (inputs[r.takeoffId]?.evidence || "").trim(),
    }));
    setBusy(true);
    try {
      const res = await sessionFetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", snapshotId: data.snapshot.id, expectedSequence, expectedActiveId, period: period.trim(), notes: notes.trim() || undefined, rows, attest }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "ثبت ناموفق بود.");
      notify("گزارش پیشرفت ثبت شد.");
      setPeriod(""); setNotes(""); setAttest(false);
      // refresh
      const refreshed = await sessionFetch(`/api/progress?snapshotId=${data.snapshot.id}`, { cache: "no-store" }).then((r) => r.json());
      setData(refreshed);
      const newActive = [...(refreshed.reports as ProgressReport[])].filter((r: ProgressReport) => !r.voidedAt).sort((a: ProgressReport, b: ProgressReport) => b.sequence - a.sequence)[0];
      const refreshedRows = (refreshed.snapshot.rows as unknown as { takeoffId: string }[]) || [];
      const next: Record<string, { currentQuantity: string; evidence: string }> = {};
      for (const row of refreshedRows) {
        const prev = newActive?.rows.find((x: ProgressRow) => x.takeoffId === row.takeoffId);
        next[row.takeoffId] = { currentQuantity: prev ? prev.currentQuantity : "0.0000", evidence: "" };
      }
      setInputs(next);
    } catch (e) { notify(e instanceof Error ? e.message : "خطای ثبت"); }
    finally { setBusy(false); }
  }

  async function voidLast() {
    if (!data || !activeReport) return;
    if (voidReason.trim().length < 5) { notify("دلیل ابطال حداقل پنج نویسه باشد."); return; }
    if (!confirm(`آخرین گزارش معتبر (دوره «${activeReport.period}» – توالی ${activeReport.sequence}) باطل شود؟ این عمل ثبت می‌ماند و مقدار مبنا به گزارش قبلی برمی‌گردد.`)) return;
    setBusy(true);
    try {
      const res = await sessionFetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", snapshotId: data.snapshot.id, reportId: activeReport.id, expectedSequence, reason: voidReason.trim() }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "ابطال ناموفق بود.");
      notify("گزارش باطل شد؛ تاریخچه حفظ شد.");
      setVoidReason("");
      const refreshed = await sessionFetch(`/api/progress?snapshotId=${data.snapshot.id}`, { cache: "no-store" }).then((r) => r.json());
      setData(refreshed);
    } catch (e) { notify(e instanceof Error ? e.message : "خطای ابطال"); }
    finally { setBusy(false); }
  }

  if (!filteredSnapshots.length) return <div className="progress-view" data-testid="progress-view"><div className="panel" style={{ padding: 20 }}><p className="muted">برای گزارش پیشرفت ابتدا یک نسخه ثابت برآورد بسازید. هر گزارش به یک نسخه قفل‌شده وابسته است و مقدارها هرگز از برآورد مبنا بیشتر نمی‌شود.</p></div></div>;

  return <div className="progress-view" data-testid="progress-view">
    <div className="panel" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div><div className="eyebrow">گزارش پیشرفت مقادیر</div><h2 style={{ margin: "6px 0 4px", fontSize: 18, fontWeight: 800 }}>پیشرفت تجمعی بر اساس نسخه ثابت</h2><p className="muted">هر دوره مقدار تجمعی اعلام می‌شود؛ مبلغ دوره از تفاضل مبالغ تجمعی گرد شده محاسبه می‌شود. سناریوی ضرایب دستی، تعدیل، مالیات و بیمه محاسبه نمی‌شود.</p></div>
        <select className="input" style={{ minWidth: 260 }} value={resolvedSnapshotId} onChange={(e) => setSnapshotId(e.target.value)} aria-label="انتخاب نسخه مبنا">
          {filteredSnapshots.sort((a, b) => b.version - a.version).map((s) => <option key={s.id} value={s.id}>نسخه {s.version} · {s.projectName || s.projectId.slice(0, 8)} · جمع {fa(s.totalRial, 0)} ریال · {new Date(s.createdAt).toLocaleDateString("fa-IR")}</option>)}
        </select>
      </div>
      <div className="form-note" style={{ marginTop: 14 }}><AlertTriangle size={16} /> این بخش فقط پیشرفت مقداری را ثبت می‌کند؛ صورت‌وضعیت مالی قراردادی، تعدیل شاخص، مالیات، بیمه و کسورات محاسبه نمی‌شود. مقدار واحد فارسی/عربی پذیرفته می‌شود اما حداکثر چهار رقم اعشار دارد و برای واحد «عدد» باید صحیح باشد. هر مقدار تجمعی نمی‌تواند از برآورد یا از گزارش قبلی کمتر شود.</div>
    </div>

    {loading && <p className="muted" style={{ padding: 16 }}>در حال بارگذاری…</p>}
    {error && <p className="draft-caution">{error}</p>}

    {data && <>
      <div className="panel" style={{ marginTop: 16, overflow: "hidden" }}>
        <div className="panel-heading"><div><h3>تاریخچه دوره‌ها</h3><p>حفظ تاریخچه؛ باطل کردن فقط برای آخرین گزارش معتبر مجاز است.</p></div><span className="badge badge-blue">{fa(data.reports.length)} گزارش</span></div>
        {data.reports.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>توالی</th><th>دوره</th><th>وضعیت</th><th>مبلغ دوره (ریال)</th><th>تجمعی (ریال)</th><th>یادداشت</th></tr></thead><tbody>
          {data.reports.sort((a, b) => a.sequence - b.sequence).map((r) => <tr key={r.id} style={{ opacity: r.voidedAt ? 0.55 : 1 }}>
            <td>{fa(r.sequence)}</td><td><strong>{r.period}</strong><small className="table-sub">{new Date(r.createdAt).toLocaleDateString("fa-IR")} {r.voidedAt ? `· باطل شده ${new Date(r.voidedAt).toLocaleDateString("fa-IR")}` : ""}</small></td>
            <td>{r.voidedAt ? <span className="badge badge-orange">باطل شده</span> : <span className="badge badge-green">معتبر</span>}{r.voidReason && <small className="table-sub">دلیل: {r.voidReason}</small>}</td>
            <td className="money-cell">{fa(r.totals.periodRial, 0)}</td><td className="money-cell">{fa(r.totals.cumulativeRial, 0)}</td><td>{r.notes || "—"}</td>
          </tr>)}
        </tbody></table></div> : <div style={{ padding: 16 }} className="muted">هنوز گزارشی ثبت نشده است.</div>}
        {activeReport && <div style={{ padding: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)" }}>
          <span className="muted">ابطال آخرین گزارش معتبر:</span><input className="input" placeholder="دلیل ابطال (حداقل ۵ نویسه)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="button button-outline" disabled={busy} onClick={() => void voidLast()}><Trash2 size={16} /> ابطال آخرین گزارش</button>
        </div>}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-heading"><div><h3>ثبت گزارش جدید</h3><p>مقدار هر ردیف را به‌صورت تجمعی وارد کنید؛ اگر نسبت به گزارش قبلی افزایش دارد، شرح منبع الزامی است. مبنا: جمع {fa(data.snapshot.totalRial, 0)} ریال.</p></div></div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="form-grid"><label className="form-field"><span>عنوان دوره *</span><input className="input" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="مثلاً مهر ۱۴۰۴ – صورت‌وضعیت ۱" maxLength={160} /></label><label className="form-field"><span>یادداشت دوره</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختیاری؛ حداکثر ۱۰۰۰ نویسه" maxLength={1000} /></label></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>ردیف</th><th>واحد</th><th>برآورد</th><th>قبلی</th><th>تجمعی جدید *</th><th>شرح / منبع اندازه‌گیری</th><th>مبلغ ردیف دوره</th></tr></thead><tbody>
            {(data.snapshot.rows as unknown as { takeoffId: string; title: string; unit: string; quantity: string; unitPriceRial: string; amountRial: string }[]).map((row, idx) => {
              const prev = activeReport?.rows.find((x) => x.takeoffId === row.takeoffId);
              const currentVal = inputs[row.takeoffId]?.currentQuantity ?? "";
              const evidenceVal = inputs[row.takeoffId]?.evidence ?? "";
              // client preview period amount
              let periodAmountPreview = "—";
              try {
                const price = Number(row.unitPriceRial);
                const prevQ = Number(prev?.currentQuantity ?? "0");
                const curQ = Number(persianToAscii(currentVal) || "0");
                if (!Number.isNaN(price) && !Number.isNaN(prevQ) && !Number.isNaN(curQ)) {
                  const prevAmt = Math.round(prevQ * price);
                  const curAmt = Math.round(curQ * price);
                  periodAmountPreview = String(curAmt - prevAmt);
                }
              } catch { }
              return <tr key={row.takeoffId}>
                <td><strong>{row.title}</strong><small className="table-sub">بهای واحد {fa(row.unitPriceRial, 2)} ریال</small></td>
                <td>{row.unit}</td>
                <td>{fa(row.quantity, 4)}</td>
                <td>{prev ? fa(prev.currentQuantity, 4) : fa("0.0000", 4)}</td>
                <td><input className="input" inputMode="decimal" value={currentVal} onChange={(e) => { const v = e.target.value; setInputs((s) => ({ ...s, [row.takeoffId]: { currentQuantity: v, evidence: s[row.takeoffId]?.evidence || "" } })); setAttest(false); }} aria-label={`مقدار تجمعی ${row.title}`} style={{ minWidth: 110 }} /></td>
                <td><input className="input" value={evidenceVal} onChange={(e) => { const v = e.target.value; setInputs((s) => ({ ...s, [row.takeoffId]: { currentQuantity: s[row.takeoffId]?.currentQuantity || "0.0000", evidence: v } })); setAttest(false); }} placeholder={Number(persianToAscii(currentVal) || "0") > Number(prev?.currentQuantity || "0") ? "الزامی" : "اختیاری"} aria-label={`منبع ${row.title}`} style={{ minWidth: 180 }} /></td>
                <td className="money-cell">{periodAmountPreview !== "—" ? fa(periodAmountPreview, 0) : "—"}</td>
              </tr>;
            })}
          </tbody></table></div>
          <label className="checkbox-row"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /><span>مقادیر را با نقشه/صورت‌جلسه تطبیق داده‌ام؛ می‌دانم این ثبت فقط پیشرفت مقداری است و تعدیل، مالیات، بیمه، کسورات یا تحویل مالی قطعی محسوب نمی‌شود.</span></label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="button button-primary" disabled={busy || !period.trim() || !attest} onClick={() => void submit()}><LockKeyhole size={16} /> {busy ? "در حال ثبت…" : "ثبت گزارش پیشرفت"}</button></div>
          {!attest && <p className="muted">برای ثبت، تأیید بالا الزامی است.</p>}
        </div>
      </div>

      {activeReport && <div className="panel" style={{ marginTop: 16, padding: 16 }}>
        <h3 style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}><FileText size={18} /> آخرین گزارش معتبر – جزئیات<button className="button button-outline button-sm" style={{ marginRight: "auto" }} onClick={() => window.open(`/report/progress/${activeReport.id}`, "_blank")}>گزارش چاپی</button></h3>
        <div className="table-scroll" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>شرح</th><th>برآورد</th><th>قبلی</th><th>تجمعی</th><th>دوره</th><th>منبع</th></tr></thead><tbody>{activeReport.rows.map((r) => <tr key={r.takeoffId}><td><strong>{r.title}</strong></td><td>{fa(r.estimatedQuantity, 4)} {r.unit}</td><td>{fa(r.previousQuantity, 4)}</td><td>{fa(r.currentQuantity, 4)}</td><td>{fa(r.periodQuantity, 4)}</td><td style={{ maxWidth: 220, whiteSpace: "pre-wrap" }}>{r.evidence || "—"}</td></tr>)}</tbody></table></div>
        <div className="report-total" style={{ marginTop: 12 }}><span>جمع دوره <small>{activeReport.period}</small></span><strong>{fa(activeReport.totals.periodRial, 0)} <small>ریال</small></strong></div>
      </div>}
    </>}
  </div>;
}
