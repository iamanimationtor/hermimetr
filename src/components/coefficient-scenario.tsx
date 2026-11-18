"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal, fa } from "@/components/ui";
import { calculateCoefficientScenario, type CoefficientFactor } from "@/lib/coefficient-scenario";

type Props = { directTotal: string; stale: boolean; busy: boolean; onClose: () => void; onSave: (factors: CoefficientFactor[]) => Promise<void> };
export function CoefficientScenarioModal({ directTotal, stale, busy, onClose, onSave }: Props) {
  const [factors, setFactors] = useState<CoefficientFactor[]>([{ label: "", multiplier: "", source: "" }]);
  const [attest, setAttest] = useState(false);
  let result: ReturnType<typeof calculateCoefficientScenario> | null = null;
  let error = "";
  try { result = calculateCoefficientScenario(directTotal, factors); }
  catch (failure) { error = failure instanceof Error ? failure.message : "ورودی معتبر نیست."; }
  const update = (index: number, field: keyof CoefficientFactor, value: string) => {
    setAttest(false);
    setFactors((current) => current.map((factor, i) => i === index ? { ...factor, [field]: value } : factor));
  };
  return <Modal eyebrow="سناریوی اختیاری" title="ضرایب دستی بر کل جمع مستقیم" size="lg" busy={busy} onClose={() => { if (!busy) onClose(); }} footer={<>
    <button type="button" className="button button-outline" disabled={busy} onClick={onClose}>انصراف</button>
    <button type="button" className="button button-primary" disabled={busy || !attest || !result || stale} onClick={() => void onSave(factors)}>{busy ? "در حال ثبت..." : "ثبت نسخه با سناریوی دستی"}</button>
  </>}>
    <div className="form-note top">این ابزار یک سناریوی دستی است، نه اعمال خودکار ضوابط ایران. هر ضریب به ترتیب روی کل جمع مرحله قبل اعمال و نتیجه هر مرحله به نزدیک‌ترین ریال، نیم به بالا گرد می‌شود. تخصیص به ردیف یا فصل و محاسبه تعدیل، مالیات، بیمه و کسورات پشتیبانی نمی‌شود.</div>
    <p>جمع مستقیم بررسی‌شده: <strong>{fa(directTotal, 0)} ریال</strong></p>
    {factors.map((factor, index) => <div className="factor-card" key={index}>
      <div className="factor-title"><strong>ضریب {fa(index + 1)}</strong>{factors.length > 1 && <button type="button" aria-label={`حذف ضریب ${index + 1}`} onClick={() => { setFactors((current) => current.filter((_, i) => i !== index)); setAttest(false); }}><Trash2 size={17} /></button>}</div>
      <div className="form-grid"><label className="form-field"><span>عنوان ضریب</span><input className="input" aria-label={`عنوان ضریب ${index + 1}`} value={factor.label} maxLength={80} onChange={(e) => update(index, "label", e.target.value)} placeholder="مثلاً ضریب توافقی" /></label>
        <label className="form-field"><span>ضریب ضربی، نه درصد</span><input className="input" aria-label={`مقدار ضریب ${index + 1}`} value={factor.multiplier} inputMode="decimal" onChange={(e) => update(index, "multiplier", e.target.value)} placeholder="مثلاً ۱٫۱" /></label>
        <label className="form-field wide"><span>مبنای قراردادی / بند و صفحه</span><input className="input" aria-label={`مبنای ضریب ${index + 1}`} value={factor.source} maxLength={300} onChange={(e) => update(index, "source", e.target.value)} placeholder="ارجاع دقیق به سند بررسی‌شده" /></label></div>
    </div>)}
    <button type="button" className="button button-soft" disabled={factors.length >= 8} onClick={() => { setFactors((current) => [...current, { label: "", multiplier: "", source: "" }]); setAttest(false); }}><Plus size={16} /> افزودن ضریب بعدی</button>
    {error && <p className="draft-caution" role="status">{error}</p>}
    {result && <div className="coefficient-result"><strong>پیش‌نمایش سناریو</strong>{result.steps.map((step, index) => <p key={index}>{fa(index + 1)}. {step.label}: {fa(step.inputRial, 0)} × {fa(step.multiplier, 6)} = <b>{fa(step.outputRial, 0)} ریال</b></p>)}<strong>مبلغ سناریو: {fa(result.finalTotalRial, 0)} ریال</strong></div>}
    {stale && <p className="draft-caution" role="alert">پیش‌نمایش تغییر کرده یا در حال تازه‌سازی است؛ پنجره را ببندید و اطلاعات را دوباره بررسی کنید.</p>}
    <label className="checkbox-row"><input type="checkbox" checked={attest} onChange={(event) => setAttest(event.target.checked)} /><span>شمول هر ضریب بر تمام ردیف‌های این جمع، ترتیب اعمال، شیوه گرد کردن و ارجاع‌ها را طبق اسناد بررسی کرده‌ام؛ مسئولیت آن را می‌پذیرم.</span></label>
  </Modal>;
}
