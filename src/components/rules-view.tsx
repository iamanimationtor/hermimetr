"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BadgeCheck, BookOpen, Calculator, Check, CircleAlert, ExternalLink, FlaskConical, GitBranch, Info, Plus, Search, ShieldAlert,
  ShieldCheck, Sigma, Trash2,
} from "lucide-react";
import {
  compileRule, evaluateRule, type NormalizedInputs, type ReviewInfo, type RuleBankEntry, type RuleDefinition, type RuleParameter,
  type RuleList, type TraceStep, type Usability,
} from "@/lib/rules/engine";
import { RULE_OPERATIONS } from "@/lib/rules/catalog";
import { measurementUnits } from "@/lib/calculations";
import { OFFICIAL_REGISTER, type OfficialDocument } from "@/lib/rules/official-register";
import { REFERENCE_CASES } from "@/lib/rules/reference-cases";
import { Badge, callApi, dateFa, Empty, fa, Modal, PanelTitle } from "@/components/ui";

export type ReferenceLite = { id: string; title: string; kind: string; status: string; documentNumber: string | null; url?: string | null };
type Notify = (message: string) => void;

const TONE = { geometric: "blue", definitive: "green", provisional: "orange", blocked: "red" } as const;
const KIND_LABEL: Record<string, string> = { pricebook: "فهرست‌بها", regulation: "مقررات", technical: "مشخصات فنی", contract: "قراردادی", adjustment: "تعدیل", other: "دستورالعمل" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "خطای نامشخص";
const versionLabel = (entry: RuleBankEntry) => `نسخه ${fa(entry.definition.version)}${entry.origin === "workspace" ? " · فضای کار" : ""}`;
const boundsText = (p: RuleParameter) => [
  p.kind === "integer" ? "عدد صحیح" : `تا ${fa(p.scale ?? 4)} رقم اعشار`,
  `${p.exclusiveMin ? "بزرگ‌تر از" : "حداقل"} ${fa(p.min ?? "0", 4)}`,
  p.max ? `حداکثر ${fa(p.max, 4)}` : "",
  p.default !== undefined ? `پیش‌فرض ${fa(p.default, 4)}` : "الزامی",
].filter(Boolean).join(" · ");

export function CertaintyBadge({ usability }: { usability: Usability }) {
  return <Badge tone={TONE[usability.certainty]}>{usability.label}</Badge>;
}

/** Step-by-step trace of a stored rule-based takeoff row (used inside the takeoff table). */
export function RuleTraceView({ trace, entry, duplicateNote, validity }: { trace: TraceStep[]; entry?: RuleBankEntry; duplicateNote?: string | null;
  validity?: { state: string; label: string; reasons: string[]; action: string } }) {
  return <div className="rule-trace-inline">
    <div className="rule-trace-head">
      <Sigma size={15} /><strong>ردیابی محاسبه با قاعده</strong>
      {entry
        ? <><span className="mono">{entry.definition.key}</span><span>{versionLabel(entry)}</span><CertaintyBadge usability={entry.usability} /></>
        : <Badge tone="red">قاعده این ردیف در بانک یافت نشد</Badge>}
    </div>
    <ol className="step-list compact">
      {trace.map((step, index) => <li key={step.key}>
        <span className="step-index">{fa(index + 1)}</span>
        <div><strong>{step.label}</strong><code className="mono">{step.expression}</code>
          <code className="mono">{step.substituted} = {step.value}{step.unit ? ` ${step.unit}` : ""}</code></div>
      </li>)}
    </ol>
    {entry && entry.definition.citations.length > 0 && <p className="rule-trace-note">
      استناد: {entry.definition.citations.map((citation) => `${citation.documentTitle}، ${citation.clause}، صفحه ${citation.page}`).join("؛ ")}
    </p>}
    {duplicateNote && <p className="rule-trace-note">دلیل ثبت ردیف مشابه: {duplicateNote}</p>}
  {validity && validity.state !== "ok" && <div className={`rule-validity state-${validity.state}`} data-testid="row-validity">
    <strong>{validity.label}</strong>{validity.reasons.map((reason) => <p key={reason}>{reason}</p>)}{validity.action && <p className="action">{validity.action}</p>}
  </div>}
  </div>;
}

/* ───────────────────────────── Rule bank view ───────────────────────────── */

type RulesViewProps = {
  bank: RuleBankEntry[]; caseReviews: Record<string, ReviewInfo>; references: ReferenceLite[]; canCalculate: boolean;
  onCalculate: (ref: string) => void; onPrefillReference: (document: OfficialDocument) => void;
  onChanged: () => Promise<unknown>; notify: Notify;
};
type ReviewSubject = { type: "rule" | "reference_case"; key: string; title: string };

export function RulesView({ bank, caseReviews, references, canCalculate, onCalculate, onPrefillReference, onChanged, notify }: RulesViewProps) {
  const [tab, setTab] = useState<"rules" | "cases" | "register">("rules");
  const [operation, setOperation] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedRef, setSelectedRef] = useState("");
  const [review, setReview] = useState<ReviewSubject | null>(null);
  const [versionBase, setVersionBase] = useState<RuleBankEntry | null>(null);
  const [openCase, setOpenCase] = useState<string | null>(null);

  const operations = useMemo(() => [...new Set([...RULE_OPERATIONS, ...bank.map((entry) => entry.definition.operation)])], [bank]);
  const visible = bank.filter((entry) => (operation === "all" || entry.definition.operation === operation)
    && `${entry.definition.title} ${entry.definition.key} ${entry.definition.operation}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = bank.find((entry) => entry.ref === selectedRef) ?? visible[0] ?? bank[0];
  const caseRuns = useMemo(() => REFERENCE_CASES.map((item) => {
    const entry = bank.find((candidate) => candidate.ref === item.ruleRef);
    if (!entry) return { item, entry: undefined, actual: null as string | null, ok: false, trace: [] as TraceStep[], error: "قاعده یافت نشد" };
    try {
      const result = evaluateRule(entry.definition, item.input);
      return { item, entry, actual: result.quantity, ok: result.quantity === item.expected, trace: result.trace, error: "" };
    } catch (error) { return { item, entry, actual: null, ok: false, trace: [], error: errorText(error) }; }
  }), [bank]);
  const stats = {
    total: bank.length,
    geometric: bank.filter((entry) => entry.usability.certainty === "geometric").length,
    definitive: bank.filter((entry) => entry.usability.certainty === "definitive").length,
    provisional: bank.filter((entry) => entry.usability.certainty === "provisional").length,
  };

  const revoke = async (subject: ReviewSubject, info: ReviewInfo) => {
    if (!window.confirm("ثبت بازبینی فعلی لغو شود؟ وضعیت به «در انتظار بازبینی» برمی‌گردد.")) return;
    const response = await callApi("/api/rules", "POST", { action: "review", subjectType: subject.type, subjectKey: subject.key, status: "revoked",
      reviewerName: info.reviewerName, reviewerCredential: info.reviewerCredential,
      reviewerRole: info.reviewerRole || "other", note: "لغو بازبینی", attest: true });
    if (!response.ok) { notify(response.data.error ?? "لغو انجام نشد."); return; }
    await onChanged();
    notify("بازبینی لغو شد.");
  };
  const retire = async (entry: RuleBankEntry) => {
    if (!entry.id || !window.confirm("این نسخه فضای کار بازنشسته شود؟ ردیف‌های قبلی حفظ می‌شوند اما محاسبه جدید با آن ممکن نخواهد بود.")) return;
    const response = await callApi("/api/rules", "POST", { action: "retire", id: entry.id });
    if (!response.ok) { notify(response.data.error ?? "انجام نشد."); return; }
    await onChanged();
    notify("نسخه بازنشسته شد.");
  };

  const reviewLine = (info: ReviewInfo | null | undefined) => info
    ? <span className={`review-line ${info.status}`} data-testid="review-line">{info.status === "approved" ? <BadgeCheck size={15} /> : <ShieldAlert size={15} />}
        {info.status === "approved" ? "تأیید" : "رد"} توسط {info.reviewerName}
        {info.reviewerRole ? ` — ${ROLE_LABEL[info.reviewerRole] ?? info.reviewerRole}` : ""}
        {info.reviewerCredential ? ` (${info.reviewerCredential})` : ""} · {dateFa(info.createdAt)}</span>
    : <span className="review-line pending"><CircleAlert size={15} /> در انتظار بازبینی متخصص</span>;

  const detail = (entry: RuleBankEntry) => {
    const def = entry.definition;
    const versions = bank.filter((candidate) => candidate.definition.key === def.key);
    const cases = caseRuns.filter((run) => run.item.ruleRef === entry.ref);
    const subject: ReviewSubject = { type: "rule", key: entry.ref, title: `${def.title} — ${versionLabel(entry)}` };
    return <section className="panel rule-card" data-testid="rule-card">
      <div className="rule-head">
        <div>
          <div className="rule-chips"><span className="mono chip">{def.key}</span><span className="chip">{versionLabel(entry)}</span>
            <span className="chip">{def.basis === "geometric" ? "رابطه هندسی" : "ضابطه اندازه‌گیری"}</span><CertaintyBadge usability={entry.usability} /></div>
          <h2>{def.title}</h2>
        </div>
        <div className="rule-actions">
          <button className="button button-primary button-sm" disabled={!canCalculate || entry.usability.certainty === "blocked"} onClick={() => onCalculate(entry.ref)}
            title={canCalculate ? "" : "ابتدا پروژه‌ای انتخاب کنید"}><Calculator size={15} /> محاسبه با این قاعده</button>
          <button className="button button-outline button-sm" onClick={() => setVersionBase(entry)}><GitBranch size={15} /> نسخه مستند جدید</button>
        </div>
      </div>
      <div className={`rule-reasons tone-${entry.usability.certainty}`}>
        {entry.usability.certainty === "definitive" ? <ShieldCheck size={17} /> : <Info size={17} />}
        <div>{entry.usability.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          {entry.usability.certainty === "provisional" && <p>نتیجه این نسخه فقط «آزمایشی» ذخیره می‌شود و قابل تأیید یا استفاده در برآورد نیست.</p>}</div>
      </div>
      <div className="fact-grid">
        <div><span>عملیات</span><strong>{def.operation}</strong></div>
        <div><span>واحد اندازه‌گیری</span><strong>{def.unit}</strong></div>
        <div><span>روش گرد کردن</span><strong>نیم به بالا تا {fa(def.rounding.scale)} رقم اعشار</strong></div>
        <div><span>دوره اعتبار</span><strong>{def.validFrom || def.validTo ? `${def.validFrom ?? "—"} تا ${def.validTo ?? "اطلاع بعدی"}` : "بدون محدودیت زمانی"}</strong></div>
      </div>

      <h4 className="rule-section-title">پارامترهای ورودی</h4>
      <div className="table-scroll"><table className="data-table param-table"><thead><tr><th>پارامتر</th><th>شناسه</th><th>واحد</th><th>قیود</th></tr></thead><tbody>
        {def.parameters.map((p) => <tr key={p.key}><td><strong>{p.label}</strong>{p.help && <small className="table-sub">{p.help}</small>}</td><td><code className="mono">{p.key}</code></td><td>{p.unit}</td><td>{boundsText(p)}</td></tr>)}
        {(def.lists ?? []).flatMap((list) => list.fields.map((field, index) => <tr key={`${list.key}.${field.key}`}>
          <td>{index === 0 && <small className="table-sub list-label">فهرست «{list.label}»{list.minItems ? ` · حداقل ${fa(list.minItems)} ردیف` : ""}</small>}<strong>{field.label}</strong></td>
          <td><code className="mono">{field.key}</code></td><td>{field.unit}</td><td>{boundsText(field)}</td></tr>))}
        {!def.parameters.length && !(def.lists ?? []).length && <tr><td colSpan={4}>بدون پارامتر</td></tr>}
      </tbody></table></div>

      <h4 className="rule-section-title">فرمول و مراحل محاسبه</h4>
      <ol className="step-list">
        {def.steps.map((step, index) => <li key={step.key} className={step.key === def.result ? "is-result" : ""}>
          <span className="step-index">{fa(index + 1)}</span>
          <div><strong>{step.label}{step.key === def.result ? " — نتیجه نهایی" : ""}</strong><code className="mono">{step.key} = {step.expression}</code></div>
        </li>)}
      </ol>
      {(def.constraints ?? []).length > 0 && <div className="constraint-list">
        {(def.constraints ?? []).map((constraint) => <p key={constraint.expression}><code className="mono">{constraint.expression}</code><span>در غیر این صورت: {constraint.message}</span></p>)}
      </div>}

      <div className="rule-texts">
        <div><h4>ضابطه اندازه‌گیری</h4><p>{def.measurementRule}</p></div>
        <div><h4>موارد کسر</h4><p>{def.deductions || "—"}</p></div>
        <div><h4>موارد اضافه</h4><p>{def.additions || "—"}</p></div>
        <div><h4>شرایط و استثناها</h4><p>{def.exceptions || "—"}</p></div>
        <div className="wide"><h4>دامنه کاربرد</h4><p>{def.scope || "—"}</p></div>
      </div>

      <h4 className="rule-section-title">منبع و محل استناد</h4>
      {def.citations.length ? def.citations.map((citation, index) => <div className="citation" key={index}>
        <div className="citation-head"><BookOpen size={16} /><strong>{citation.documentTitle}</strong>
          <Badge tone={entry.sourceVerified ? "green" : "orange"}>{entry.sourceVerified ? "سند بازبینی‌شده" : "سند تأییدنشده"}</Badge></div>
        <div className="citation-meta"><span>شماره: {citation.documentNumber || "—"}</span><span>تاریخ: {citation.documentDate || "—"}</span><span>بند: {citation.clause}</span><span>صفحه: {citation.page}</span></div>
        {citation.quote && <blockquote>{citation.quote}</blockquote>}
        {citation.note && <p className="citation-note">{citation.note}</p>}
      </div>) : <p className="rule-plain">این قاعده یک رابطه هندسی است و به سند ضابطه‌ای استناد نمی‌کند؛ صحت آن با مثال‌های مرجع و محاسبه مستقل کنترل می‌شود.</p>}

      <h4 className="rule-section-title">بازبینی متخصص</h4>
      <div className="review-box">{reviewLine(entry.review)}
        {entry.review?.note && <p>{entry.review.note}</p>}
        <div className="review-actions">
          <button className="button button-soft button-sm" onClick={() => setReview(subject)}><BadgeCheck size={15} /> ثبت بازبینی</button>
          {entry.review && <button className="text-link" onClick={() => void revoke(subject, entry.review!)}>لغو بازبینی</button>}
          {entry.origin === "workspace" && entry.lifecycle === "active" && <button className="text-link danger-text" onClick={() => void retire(entry)}><Trash2 size={14} /> بازنشسته کردن نسخه</button>}
        </div>
      </div>

      <h4 className="rule-section-title">مثال‌های مرجع این نسخه</h4>
      {cases.length ? <div className="case-chips">{cases.map((run) => <button key={run.item.id} className={`case-chip ${run.ok ? "ok" : "fail"}`} onClick={() => { setTab("cases"); setOpenCase(run.item.id); }}>
        {run.ok ? <Check size={14} /> : <CircleAlert size={14} />}<span>{run.item.id}</span><small>{run.item.title}</small></button>)}</div>
        : <p className="rule-plain">برای نسخه‌های فضای کار، مثال مرجع باید توسط متخصص تهیه و پیش از تأیید کنترل شود.</p>}

      <h4 className="rule-section-title">نسخه‌های این قاعده</h4>
      <div className="version-list">{versions.map((candidate) => <button key={candidate.ref} className={candidate.ref === entry.ref ? "active" : ""} onClick={() => setSelectedRef(candidate.ref)}>
        <span>{versionLabel(candidate)}</span><CertaintyBadge usability={candidate.usability} /><small>{candidate.definition.changeNote || candidate.definition.title}</small></button>)}</div>
      <p className="hash-line">اثر انگشت تعریف (SHA-256): <code className="mono">{entry.hash}</code></p>
    </section>;
  };

  return <>
    <div className="page-intro"><div>
      <div className="eyebrow">موتور قواعد <span className="eyebrow-divider">/</span> نسخه‌دار و قابل ردیابی</div>
      <h1>بانک قواعد متره</h1>
      <p>هر قاعده شناسنامه، فرمول ایمن، محل استناد و وضعیت اعتبار خودش را دارد؛ هیچ قاعده تأییدنشده‌ای مقدار قطعی تولید نمی‌کند.</p>
    </div></div>
    <div className="rule-legend">
      <div><Badge tone="blue">هندسی پایه</Badge><span>رابطه ریاضی؛ با مثال مرجع و محاسبه مستقل کنترل شده و ضابطه پرداخت نیست.</span></div>
      <div><Badge tone="orange">آزمایشی — تأییدنشده</Badge><span>ضابطه‌ای که سند رسمی یا تأیید متخصص آن کامل نیست؛ فقط محاسبه آزمایشی.</span></div>
      <div><Badge tone="green">ضابطه تأییدشده</Badge><span>سند مرجع بازبینی شده و نسخه را متخصص تأیید کرده است.</span></div>
    </div>
    <div className="mini-stats">
      <div><span>قاعده و نسخه</span><strong>{fa(stats.total)}</strong></div>
      <div><span>هندسی پایه</span><strong>{fa(stats.geometric)}</strong></div>
      <div><span>ضابطه تأییدشده</span><strong>{fa(stats.definitive)}</strong></div>
      <div><span>ضابطه تأییدنشده</span><strong>{fa(stats.provisional)}</strong></div>
    </div>
    <div className="toolbar rule-toolbar">
      <div className="segmented">
        <button className={tab === "rules" ? "selected" : ""} onClick={() => setTab("rules")}>شناسنامه قواعد</button>
        <button className={tab === "cases" ? "selected" : ""} onClick={() => setTab("cases")}>مثال‌های مرجع</button>
        <button className={tab === "register" ? "selected" : ""} onClick={() => setTab("register")}>دفتر منابع رسمی</button>
      </div>
      {tab === "rules" && <div className="filter-search"><Search size={17} /><input placeholder="جست‌وجوی عنوان یا شناسه قاعده..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>}
    </div>

    {tab === "rules" && <div className="rule-layout">
      <aside className="panel rule-list">
        <div className="rule-filter">
          <button className={operation === "all" ? "active" : ""} onClick={() => setOperation("all")}>همه</button>
          {operations.map((name) => <button key={name} className={operation === name ? "active" : ""} onClick={() => setOperation(name)}>{name}</button>)}
        </div>
        {operations.filter((name) => visible.some((entry) => entry.definition.operation === name)).map((name) => <div key={name} className="rule-group">
          <span className="rule-group-label">{name}</span>
          {visible.filter((entry) => entry.definition.operation === name).map((entry) => <button key={entry.ref} data-rule={entry.ref}
            className={`rule-item ${selected?.ref === entry.ref ? "active" : ""}`} onClick={() => setSelectedRef(entry.ref)}>
            <strong>{entry.definition.title}</strong>
            <span><code className="mono">{entry.definition.key}</code><em>{versionLabel(entry)}</em></span>
            <CertaintyBadge usability={entry.usability} />
          </button>)}
        </div>)}
        {!visible.length && <p className="rule-plain pad">قاعده‌ای با این فیلتر پیدا نشد.</p>}
      </aside>
      {selected ? detail(selected) : <section className="panel"><Empty icon={Sigma} title="قاعده‌ای انتخاب نشده" description="از فهرست یک قاعده را انتخاب کنید." /></section>}
    </div>}

    {tab === "cases" && <section className="panel table-panel">
      <PanelTitle title="مجموعه محاسبات مرجع" subtitle="هر مثال سه بار محاسبه شده است: دستی، با موتور قواعد و با حساب کسری دقیقِ مستقل (در آزمون‌های خودکار)"
        action={<Badge tone={caseRuns.every((run) => run.ok) ? "green" : "red"}>{fa(caseRuns.filter((run) => run.ok).length)} از {fa(caseRuns.length)} منطبق</Badge>} />
      <div className="table-scroll"><table className="data-table case-table"><thead><tr><th>مثال</th><th>قاعده</th><th>نتیجه مرجع</th><th>نتیجه موتور</th><th>تطبیق</th><th>بازبینی مهندسی</th></tr></thead>
        {caseRuns.map((run) => {
          const info = caseReviews[run.item.id];
          const subject: ReviewSubject = { type: "reference_case", key: run.item.id, title: `${run.item.id} — ${run.item.title}` };
          return <tbody key={run.item.id}>
            <tr className="clickable-row" onClick={() => setOpenCase(openCase === run.item.id ? null : run.item.id)}>
              <td><strong>{run.item.id} · {run.item.title}</strong><small className="table-sub">{run.item.purpose}</small></td>
              <td><code className="mono">{run.entry?.definition.key ?? run.item.ruleRef}</code><small className="table-sub">{run.entry ? versionLabel(run.entry) : ""}</small></td>
              <td><strong>{fa(run.item.expected, 4)}</strong> <small>{run.item.unit}</small></td>
              <td>{run.actual ? <strong>{fa(run.actual, 4)}</strong> : <span className="danger-text">{run.error}</span>}</td>
              <td><Badge tone={run.ok ? "green" : "red"}>{run.ok ? "منطبق" : "مغایر"}</Badge></td>
              <td onClick={(event) => event.stopPropagation()}>{reviewLine(info)}
                <div className="review-actions"><button className="text-link" onClick={() => setReview(subject)}>ثبت بازبینی</button>
                  {info && <button className="text-link" onClick={() => void revoke(subject, info)}>لغو</button>}</div></td>
            </tr>
            {openCase === run.item.id && <tr className="expanded-tr"><td colSpan={6}><div className="case-detail">
              <div><h4>مشخصات هندسی و ورودی</h4><p>{run.item.geometry}</p>
                <h4>محاسبه دستی</h4><ol className="hand-steps">{run.item.handSteps.map((step) => <li key={step}><bdi className="mono">{step}</bdi></li>)}</ol></div>
              <div><h4>مراحل محاسبه موتور</h4><ol className="step-list compact">{run.trace.map((step, index) => <li key={step.key}><span className="step-index">{fa(index + 1)}</span>
                <div><strong>{step.label}</strong><code className="mono">{step.substituted} = {step.value}</code></div></li>)}</ol></div>
            </div></td></tr>}
          </tbody>;
        })}
      </table></div>
      <p className="footnote pad"><Info size={15} /> مثال‌های دارای برچسب «پیش‌نویس» فقط درستیِ پیاده‌سازیِ متن نقل‌شده را می‌سنجند، نه اعتبار خود ضابطه را. بازبینی مهندسی یک اقدام انسانی است و جداگانه ثبت می‌شود.</p>
    </section>}

    {tab === "register" && <>
      <div className="source-warning"><ShieldAlert size={21} /><div><strong>هیچ‌یک از این اسناد تأیید نشده‌اند</strong>
        <p>درگاه‌های رسمی از محیط توسعه در دسترس نبودند؛ مشخصات زیر فقط از منابع واسط شناسایی شده است. هر سند را پس از تطبیق با نسخه رسمی، در «منابع مرجع» ثبت و تأیید کنید.</p></div></div>
      <div className="register-grid">{OFFICIAL_REGISTER.map((document) => <article className="panel register-card" key={document.key}>
        <div className="register-top"><Badge tone="neutral">{KIND_LABEL[document.kind]}</Badge><Badge tone="orange">تأییدنشده</Badge></div>
        <h3>{document.title}</h3>
        <p className="register-issuer">{document.issuer}</p>
        <dl>
          <div><dt>شماره</dt><dd>{document.documentNumber || "نامشخص"}</dd></div>
          <div><dt>تاریخ ابلاغ</dt><dd>{document.issueDate || "نامشخص"}</dd></div>
          <div><dt>تاریخ اجرا</dt><dd>{document.effectiveDate || "نامشخص"}</dd></div>
          <div><dt>دوره مبنا</dt><dd>{document.basePeriod || "—"}</dd></div>
        </dl>
        <p><b>دامنه کاربرد:</b> {document.scope}</p>
        <p><b>کاربرد در سامانه:</b> {document.relevance}</p>
        {document.reports && document.reports.length > 0 && <div className="report-list"><b>گزارش‌های تاریخ‌دار منابع واسط:</b>
          <ul>{document.reports.map((report) => <li key={report}>{report}</li>)}</ul></div>}
        <p><b>نحوه شناسایی:</b> {document.identifiedFrom}</p>
        <p><b>تلاش برای اعتبارسنجی:</b> {document.verificationAttempt}</p>
        <div className="register-actions">
          {document.portalUrl ? <a className="text-link" href={document.portalUrl} target="_blank" rel="noopener noreferrer">{document.portalName} <ExternalLink size={14} /></a> : <span className="muted">{document.portalName}</span>}
          <button className="button button-outline button-sm" onClick={() => onPrefillReference(document)}><Plus size={15} /> ثبت در منابع مرجع</button>
        </div>
      </article>)}</div>
    </>}

    {review && <ReviewModal subject={review} onClose={() => setReview(null)} onDone={onChanged} notify={notify} />}
    {versionBase && <VersionModal base={versionBase} references={references} onClose={() => setVersionBase(null)} notify={notify}
      onDone={async (ref) => { await onChanged(); setSelectedRef(ref); }} />}
  </>;
}

const ROLE_LABEL: Record<string, string> = {
  estimator: "مترور / کارشناس متره", reviewer: "بازبین فنی", technical_manager: "مدیر دفتر فنی",
  external_expert: "متخصص بیرونی", other: "سایر",
};
const OUTPUT_KINDS: [string, string][] = [["length", "طول (متر)"], ["area", "مساحت (مترمربع)"], ["volume", "حجم (مترمکعب)"], ["count", "تعداد (عدد)"], ["weight", "وزن (کیلوگرم)"]];
const emptyParameter = (): RuleParameter => ({ key: "", label: "", unit: "متر", kind: "decimal", scale: 4 });

function ReviewModal({ subject, onClose, onDone, notify }: { subject: ReviewSubject; onClose: () => void; onDone: () => Promise<unknown>; notify: Notify }) {
  const [form, setForm] = useState({ reviewerName: "", reviewerCredential: "", reviewerRole: "estimator", note: "", status: "approved", attest: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    const response = await callApi("/api/rules", "POST", { action: "review", subjectType: subject.type, subjectKey: subject.key, ...form });
    setBusy(false);
    if (!response.ok) { setError(response.data.error ?? "ثبت بازبینی انجام نشد."); return; }
    await onDone();
    notify(form.status === "approved" ? "تأیید متخصص ثبت شد." : "رد متخصص ثبت شد.");
    onClose();
  };
  return <Modal eyebrow="بازبینی مهندسی" title="ثبت نتیجه بازبینی" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={onClose}>انصراف</button>
    <button type="button" className="button button-primary" data-testid="review-submit" disabled={busy || !form.attest || form.reviewerName.trim().length < 2} onClick={() => void submit()}>{busy ? "در حال ثبت..." : "ثبت بازبینی"}</button>
  </>}>
    <p className="modal-lead">{subject.title}</p>
    <div className="form-grid">
      <label className="form-field"><span>نام بازبین<em>*</em></span><input className="input" data-testid="review-name" value={form.reviewerName} onChange={(event) => setForm({ ...form, reviewerName: event.target.value })} placeholder="نام و نام خانوادگی" /></label>
      <label className="form-field"><span>نقش بازبین<em>*</em></span><select className="input" data-testid="review-role" value={form.reviewerRole} onChange={(event) => setForm({ ...form, reviewerRole: event.target.value })}>
        {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field wide"><span>صلاحیت / شماره عضویت</span><input className="input" value={form.reviewerCredential} onChange={(event) => setForm({ ...form, reviewerCredential: event.target.value })} placeholder="مثلاً شماره پروانه یا عضویت نظام مهندسی" /></label>
      <label className="form-field wide"><span>نتیجه</span><select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
        <option value="approved">تأیید می‌شود</option><option value="rejected">رد می‌شود (استفاده از آن مسدود خواهد شد)</option></select></label>
      <label className="form-field wide"><span>یادداشت بازبینی</span><textarea className="input" rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="روش کنترل، سند تطبیق‌داده‌شده و ملاحظات" /></label>
    </div>
    <label className="checkbox-row"><input type="checkbox" data-testid="review-attest" checked={form.attest} onChange={(event) => setForm({ ...form, attest: event.target.checked })} />
      <span>فرمول، پارامترها، استثناها و نتیجه محاسبه را شخصاً کنترل کرده‌ام و مسئولیت این بازبینی را با نقش اعلام‌شده می‌پذیرم.</span></label>
    <div className="form-note"><Info size={17} /> بازبینی به محتوای دقیق همین نسخه (اثر انگشت تعریف) گره می‌خورد و هویت، نقش، سند مرجع و نسخه قاعده در سوابق ثبت می‌شود. ردیف‌هایی که با این نسخه محاسبه شده‌اند، با تغییر وضعیت آن علامت‌گذاری می‌شوند اما مقدار و تاریخچه‌شان دست‌نخورده می‌ماند.</div>
    {error && <div className="error-box"><CircleAlert size={16} /> {error}</div>}
  </Modal>;
}

/** Full rule-definition editor: identity, parameters, lists, steps, constraints, texts and citation. */
function VersionModal({ base, references, onClose, onDone, notify }: {
  base: RuleBankEntry; references: ReferenceLite[]; onClose: () => void; onDone: (ref: string) => Promise<unknown>; notify: Notify;
}) {
  const def = base.definition;
  const [form, setForm] = useState({
    key: def.key, newKey: false, title: def.title, operation: def.operation, discipline: def.discipline,
    outputKind: def.outputKind, basis: def.basis, roundingScale: def.rounding.scale,
    measurementRule: def.measurementRule, additions: def.additions, deductions: def.deductions,
    exceptions: def.exceptions, scope: def.scope, referenceId: def.citations[0]?.referenceId ?? "",
    clause: def.citations[0]?.clause ?? "", page: def.citations[0]?.page ?? "", quote: def.citations[0]?.quote ?? "",
    validFrom: def.validFrom ?? "", validTo: def.validTo ?? "", changeNote: "",
  });
  const [parameters, setParameters] = useState<RuleParameter[]>(() => def.parameters.map((p) => ({ ...p })));
  const [lists, setLists] = useState<RuleList[]>(() => (def.lists ?? []).map((list) => ({ ...list, fields: list.fields.map((field) => ({ ...field })) })));
  const [steps, setSteps] = useState(() => def.steps.map((step) => ({ ...step })));
  const [constraints, setConstraints] = useState(() => (def.constraints ?? []).map((item) => ({ ...item })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string | boolean | number) => setForm((old) => ({ ...old, [key]: value }));

  /** Builds the candidate definition; the live validator runs the same check the server runs. */
  const buildDefinition = useCallback(
    (): RuleDefinition => ({
      key: form.key.trim(), version: 1, title: form.title, operation: form.operation, discipline: form.discipline,
      outputKind: form.outputKind as RuleDefinition["outputKind"], unit: measurementUnits[form.outputKind as keyof typeof measurementUnits],
      basis: form.basis as RuleDefinition["basis"], parameters, lists, steps,
      result: steps.length ? steps[steps.length - 1].key : "",
      constraints, rounding: { scale: form.roundingScale, mode: "half_up" },
      measurementRule: form.measurementRule, additions: form.additions, deductions: form.deductions,
      exceptions: form.exceptions, scope: form.scope,
      citations: form.basis === "regulatory" ? [{ documentTitle: references.find((item) => item.id === form.referenceId)?.title ?? "—", clause: form.clause, page: form.page, quote: form.quote }] : [],
      validFrom: null, validTo: null, sourceStatus: "unverified",
    }), [form, parameters, lists, steps, constraints, references]);

  const ruleKey = form.key.trim();
  const problem = useMemo(() => {
    if (!ruleKey) return "شناسه قاعده معتبر نیست (حروف کوچک، عدد و نقطه؛ مثلاً plaster.new_rule).";
    try { compileRule(buildDefinition()); return ""; }
    catch (compileError) { return compileError instanceof Error ? compileError.message : "تعریف قاعده معتبر نیست."; }
  }, [buildDefinition, ruleKey]);

  const names = [...parameters.map((p) => p.key), ...lists.flatMap((list) => [list.key, ...list.fields.map((field) => field.key)])]
    .concat(steps.map((step) => step.key)).filter(Boolean);
  const regulatoryMissing = form.basis === "regulatory" && (!form.referenceId || !form.clause.trim() || !form.page.trim());
  const ready = !problem && !regulatoryMissing && form.title.trim() && form.measurementRule.trim() && form.changeNote.trim() && form.operation.trim();

  const submit = async () => {
    setBusy(true); setError("");
    const payload = {
      action: "createVersion", baseRef: base.ref, key: form.key.trim(), title: form.title, operation: form.operation, discipline: form.discipline,
      outputKind: form.outputKind, basis: form.basis, parameters, lists, steps, result: steps[steps.length - 1].key,
      constraints, roundingScale: form.roundingScale, measurementRule: form.measurementRule, additions: form.additions,
      deductions: form.deductions, exceptions: form.exceptions, scope: form.scope,
      referenceId: form.referenceId || null, clause: form.clause, page: form.page, quote: form.quote,
      validFrom: form.validFrom, validTo: form.validTo, changeNote: form.changeNote,
    };
    const response = await callApi<{ version: { ref: string; version: number } }>("/api/rules", "POST", payload);
    setBusy(false);
    if (!response.ok || !response.data.version) { setError(response.data.error ?? "نسخه ثبت نشد."); return; }
    await onDone(response.data.version.ref);
    notify(`نسخه ${fa(response.data.version.version)} ثبت شد و تا تأیید سند و متخصص قابل اتکا نیست.`);
    onClose();
  };

  return <Modal eyebrow="نسخه‌گذاری قواعد" title={form.newKey ? "تعریف قاعده جدید در فضای کار" : "نسخه جدید این قاعده"} size="xl" busy={busy} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={onClose}>انصراف</button>
    <button type="button" className="button button-primary" data-testid="version-submit" disabled={busy || !ready} onClick={() => void submit()}>{busy ? "در حال ثبت..." : "ثبت نسخه جدید"}</button>
  </>}>
    <div className="form-note top"><Info size={17} /> نسخه‌های قبلی تغییر نمی‌کنند. نتیجه این نسخه تا زمان تأیید سند مرجع و بازبینی متخصص، «آزمایشی» یا «در انتظار بازبینی» می‌ماند و در برآورد به‌کار نمی‌رود.</div>

    <div className="form-section-title">شناسه و ماهیت قاعده</div>
    <div className="form-grid">
      <label className="checkbox-row slim"><input type="checkbox" checked={form.newKey} onChange={(event) => set("newKey", event.target.checked)} /><span>قاعده جدید با شناسه دیگر (برای توسعه رشته‌های جدید)</span></label>
      <label className="form-field"><span>شناسه قاعده<em>*</em></span>
        <input className="input mono" dir="ltr" data-testid="version-key" value={form.key} disabled={!form.newKey} onChange={(event) => set("key", event.target.value)} /></label>
      <label className="form-field"><span>عنوان<em>*</em></span><input className="input" value={form.title} onChange={(event) => set("title", event.target.value)} /></label>
      <label className="form-field"><span>عملیات<em>*</em></span><input className="input" list="rule-operations" value={form.operation} onChange={(event) => set("operation", event.target.value)} />
        <datalist id="rule-operations">{RULE_OPERATIONS.map((name) => <option key={name} value={name} />)}</datalist></label>
      <label className="form-field"><span>رشته</span><input className="input" value={form.discipline} onChange={(event) => set("discipline", event.target.value)} /></label>
      <label className="form-field"><span>نوع کمیت و واحد خروجی</span><select className="input" value={form.outputKind} onChange={(event) => set("outputKind", event.target.value)}>
        {OUTPUT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field"><span>ماهیت قاعده</span><select className="input" value={form.basis} onChange={(event) => set("basis", event.target.value)}>
        <option value="geometric">رابطه هندسی (بدون ادعای ضابطه)</option><option value="regulatory">ضابطه اندازه‌گیری (نیازمند سند و استناد)</option></select></label>
      <label className="form-field"><span>رقم اعشار گرد کردن</span><select className="input" value={form.roundingScale} onChange={(event) => set("roundingScale", Number(event.target.value))}>
        {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{fa(value)} رقم (نیم به بالا)</option>)}</select></label>
    </div>

    <div className="form-section-title">پارامترها <span>ورودی‌های عددی قاعده</span></div>
    <div className="grid-editor" data-testid="parameters-editor">
      <div className="grid-editor-head"><span>شناسه</span><span>برچسب</span><span>واحد</span><span>نوع</span><span>حداقل</span><span>اعشار</span><span /></div>
      {parameters.map((p, index) => <div key={index}>
        <input className="input mono" dir="ltr" value={p.key} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
        <input className="input" value={p.label} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
        <input className="input" value={p.unit} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, unit: event.target.value } : item))} />
        <select className="input" value={p.kind} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, kind: event.target.value as RuleParameter["kind"] } : item))}>
          <option value="decimal">اعشاری</option><option value="integer">صحیح</option></select>
        <input className="input" value={p.min ?? "0"} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, min: event.target.value } : item))} />
        <input className="input" value={p.scale ?? 4} onChange={(event) => setParameters(parameters.map((item, i) => i === index ? { ...item, scale: Number(event.target.value) || 0 } : item))} />
        <button type="button" className="icon-remove" title="حذف پارامتر" onClick={() => setParameters(parameters.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
      </div>)}
      <button type="button" className="button button-soft button-sm add-row" data-testid="add-parameter" onClick={() => setParameters([...parameters, emptyParameter()])}><Plus size={14} /> افزودن پارامتر</button>
    </div>

    <div className="form-section-title">فهرست‌های ورودی <span>برای بازشوها، لیستوفر، پروفیل‌ها و مانند آن</span></div>
    {lists.map((list, listIndex) => <div className="nested-editor" key={listIndex}>
      <div className="nested-editor-head">
        <input className="input mono" dir="ltr" placeholder="شناسه فهرست" value={list.key} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, key: event.target.value } : item))} />
        <input className="input" placeholder="برچسب فهرست" value={list.label} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, label: event.target.value } : item))} />
        <button type="button" className="button button-soft button-sm" onClick={() => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: [...item.fields, emptyParameter()] } : item))}><Plus size={14} /> فیلد</button>
        <button type="button" className="icon-remove" title="حذف فهرست" onClick={() => setLists(lists.filter((_, i) => i !== listIndex))}><Trash2 size={15} /></button>
      </div>
      {list.fields.map((field, fieldIndex) => <div className="grid-editor nested" key={fieldIndex}>
        <input className="input mono" dir="ltr" value={field.key} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, key: event.target.value } : f) } : item))} />
        <input className="input" value={field.label} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, label: event.target.value } : f) } : item))} />
        <input className="input" value={field.unit} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, unit: event.target.value } : f) } : item))} />
        <select className="input" value={field.kind} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, kind: event.target.value as RuleParameter["kind"] } : f) } : item))}>
          <option value="decimal">اعشاری</option><option value="integer">صحیح</option></select>
        <input className="input" value={field.min ?? "0"} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, min: event.target.value } : f) } : item))} />
        <input className="input" value={field.scale ?? 4} onChange={(event) => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.map((f, j) => j === fieldIndex ? { ...f, scale: Number(event.target.value) || 0 } : f) } : item))} />
        <button type="button" className="icon-remove" title="حذف فیلد" onClick={() => setLists(lists.map((item, i) => i === listIndex ? { ...item, fields: item.fields.filter((_, j) => j !== fieldIndex) } : item))}><Trash2 size={15} /></button>
      </div>)}
    </div>)}
    <button type="button" className="button button-soft button-sm add-row" data-testid="add-list" onClick={() => setLists([...lists, { key: "", label: "", fields: [emptyParameter()] }])}><Plus size={14} /> افزودن فهرست ورودی</button>

    <div className="form-section-title">مراحل محاسبه <span>آخرین مرحله، نتیجه نهایی است</span></div>
    <div className="name-chips">{names.length ? names.map((name) => <code key={name} className="mono chip">{name}</code>) : <span className="muted">ابتدا پارامتر تعریف کنید</span>}<code className="mono chip">PI</code></div>
    <div className="step-editor">{steps.map((step, index) => <div key={index}>
      <span className="step-index">{fa(index + 1)}</span>
      <input className="input mono" dir="ltr" aria-label="شناسه مرحله" placeholder="کلید" title="شناسه انگلیسی مرحله (مثلاً net)" value={step.key} onChange={(event) => setSteps(steps.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
      <input className="input" aria-label={`برچسب مرحله ${step.key || index + 1}`} value={step.label} onChange={(event) => setSteps(steps.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
      <input className="input mono step-formula" dir="ltr" aria-label={`فرمول مرحله ${step.key || index + 1}`} value={step.expression} onChange={(event) => setSteps(steps.map((item, i) => i === index ? { ...item, expression: event.target.value } : item))} />
      <button type="button" className="icon-remove" title="حذف مرحله" onClick={() => setSteps(steps.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
    </div>)}
      <button type="button" className="button button-soft button-sm add-row" data-testid="add-step" onClick={() => setSteps([...steps, { key: "", label: "", expression: "" }])}><Plus size={14} /> افزودن مرحله</button>
    </div>

    <div className="form-section-title">شرط‌های کنترلی <span>در صورت نقض، محاسبه انجام نمی‌شود</span></div>
    {constraints.map((item, index) => <div className="constraint-editor" key={index}>
      <input className="input mono" dir="ltr" placeholder="عبارت شرط" value={item.expression} onChange={(event) => setConstraints(constraints.map((entry, i) => i === index ? { ...entry, expression: event.target.value } : entry))} />
      <input className="input" placeholder="پیام خطا" value={item.message} onChange={(event) => setConstraints(constraints.map((entry, i) => i === index ? { ...entry, message: event.target.value } : entry))} />
      <button type="button" className="icon-remove" title="حذف شرط" onClick={() => setConstraints(constraints.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
    </div>)}
    <button type="button" className="button button-soft button-sm add-row" onClick={() => setConstraints([...constraints, { expression: "", message: "" }])}><Plus size={14} /> افزودن شرط</button>

    <div className="form-section-title">متن‌های شناسنامه قاعده</div>
    <div className="form-grid">
      <label className="form-field wide"><span>ضابطه اندازه‌گیری<em>*</em></span><textarea className="input" rows={2} value={form.measurementRule} onChange={(event) => set("measurementRule", event.target.value)} /></label>
      <label className="form-field"><span>موارد کسر</span><textarea className="input" rows={2} value={form.deductions} onChange={(event) => set("deductions", event.target.value)} /></label>
      <label className="form-field"><span>موارد اضافه</span><textarea className="input" rows={2} value={form.additions} onChange={(event) => set("additions", event.target.value)} /></label>
      <label className="form-field"><span>شرایط و استثناها</span><textarea className="input" rows={2} value={form.exceptions} onChange={(event) => set("exceptions", event.target.value)} /></label>
      <label className="form-field"><span>دامنه کاربرد</span><textarea className="input" rows={2} value={form.scope} onChange={(event) => set("scope", event.target.value)} /></label>
    </div>

    <div className="form-section-title">منبع رسمی و محل دقیق استناد <span>برای قاعده ضابطه‌ای الزامی است</span></div>
    <div className="form-grid">
      <label className="form-field wide"><span>سند مرجع از کتابخانه منابع</span><select className="input" data-testid="version-reference" value={form.referenceId} onChange={(event) => set("referenceId", event.target.value)}>
        <option value="">بدون سند (فقط برای رابطه هندسی)</option>
        {references.map((reference) => <option key={reference.id} value={reference.id}>{reference.title}{reference.documentNumber ? ` (${reference.documentNumber})` : ""} — {reference.status === "verified" ? "بازبینی‌شده" : "تأییدنشده"}</option>)}</select></label>
      <label className="form-field"><span>بند / ردیف</span><input className="input" value={form.clause} onChange={(event) => set("clause", event.target.value)} placeholder="فصل، بخش و شماره بند" /></label>
      <label className="form-field"><span>صفحه</span><input className="input" value={form.page} onChange={(event) => set("page", event.target.value)} placeholder="شماره صفحه در نسخه رسمی" /></label>
      <label className="form-field wide"><span>متن بند (نقل از سند)</span><textarea className="input" rows={2} value={form.quote} onChange={(event) => set("quote", event.target.value)} /></label>
      <label className="form-field"><span>شروع اعتبار</span><input className="input" value={form.validFrom} onChange={(event) => set("validFrom", event.target.value)} placeholder="۱۴۰۴/۰۱/۰۱" /></label>
      <label className="form-field"><span>پایان اعتبار</span><input className="input" value={form.validTo} onChange={(event) => set("validTo", event.target.value)} placeholder="خالی = تا اطلاع بعدی" /></label>
      <label className="form-field wide"><span>دلیل و شرح تغییر<em>*</em></span><textarea className="input" rows={2} data-testid="version-change-note" value={form.changeNote} onChange={(event) => set("changeNote", event.target.value)} placeholder="چه چیزی نسبت به نسخه پایه تغییر کرده و بر چه مبنایی" /></label>
    </div>
    {regulatoryMissing && <div className="error-box"><CircleAlert size={16} /> برای قاعده ضابطه‌ای، سند مرجع، بند و صفحه الزامی است.</div>}
    {problem ? <div className="error-box"><CircleAlert size={16} /> {problem}</div> : <div className="ok-box"><Check size={16} /> تعریف قاعده معتبر است و فرمول‌ها ایمن ارزیابی می‌شوند.</div>}
    {error && <div className="error-box"><CircleAlert size={16} /> {error}</div>}
  </Modal>;
}

/* ───────────────────────────── Rule calculator ───────────────────────────── */

type CalculatorRow = { id: string; title: string; floor: string | null; location: string | null; sourceNote: string | null; documentId: string | null; ruleRef: string | null; ruleInputs: NormalizedInputs | null };
type CalculatorProps = {
  bank: RuleBankEntry[]; initialRef?: string; row: CalculatorRow | null;
  project: { id: string; name: string; isDemo: boolean; estimateDate: string | null } | null;
  documents: { id: string; fileName: string }[]; onClose: () => void; onSaved: (message: string) => Promise<unknown> | void;
};
type Draft = { values: Record<string, string>; lists: Record<string, Record<string, string>[]> };

const blankItem = (fields: RuleParameter[]) => Object.fromEntries(fields.map((field) => [field.key, field.default ?? ""]));
const blankDraft = (def: RuleDefinition): Draft => ({
  values: Object.fromEntries(def.parameters.map((p) => [p.key, p.default ?? ""])),
  lists: Object.fromEntries((def.lists ?? []).map((list) => [list.key, Array.from({ length: list.minItems ?? 0 }, () => blankItem(list.fields))])),
});

export function RuleCalculator({ bank, initialRef, row, project, documents, onClose, onSaved }: CalculatorProps) {
  const selectable = bank.filter((entry) => entry.usability.certainty !== "blocked" || entry.ref === row?.ruleRef);
  const [ruleRef, setRuleRef] = useState(() => row?.ruleRef ?? initialRef ?? selectable[0]?.ref ?? "");
  const entry = bank.find((candidate) => candidate.ref === ruleRef);
  const [draft, setDraft] = useState<Draft>(() => {
    if (row?.ruleInputs && row.ruleRef === ruleRef) return { values: { ...row.ruleInputs.values }, lists: Object.fromEntries(Object.entries(row.ruleInputs.lists).map(([key, items]) => [key, items.map((item) => ({ ...item }))])) };
    return entry ? blankDraft(entry.definition) : { values: {}, lists: {} };
  });
  const [meta, setMeta] = useState({ title: row?.title ?? "", floor: row?.floor ?? "", location: row?.location ?? "", sourceNote: row?.sourceNote ?? "", documentId: row?.documentId ?? "" });
  const [duplicate, setDuplicate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    if (!entry) return { result: null, error: "قاعده‌ای انتخاب نشده است." };
    try { return { result: evaluateRule(entry.definition, draft), error: "" }; } catch (evaluationError) { return { result: null, error: errorText(evaluationError) }; }
  }, [entry, draft]);
  const def = entry?.definition;
  const chooseRule = (ref: string) => {
    const next = bank.find((candidate) => candidate.ref === ref);
    setRuleRef(ref); setDuplicate(""); setError("");
    if (next) setDraft(blankDraft(next.definition));
  };
  const setValue = (key: string, value: string) => setDraft((old) => ({ ...old, values: { ...old.values, [key]: value } }));
  const setItem = (list: string, index: number, key: string, value: string) => setDraft((old) => ({ ...old,
    lists: { ...old.lists, [list]: (old.lists[list] ?? []).map((item, i) => i === index ? { ...item, [key]: value } : item) } }));
  const addItem = (list: string, fields: RuleParameter[]) => setDraft((old) => ({ ...old, lists: { ...old.lists, [list]: [...(old.lists[list] ?? []), blankItem(fields)] } }));
  const removeItem = (list: string, index: number) => setDraft((old) => ({ ...old, lists: { ...old.lists, [list]: (old.lists[list] ?? []).filter((_, i) => i !== index) } }));

  const save = async () => {
    if (!project || !entry || !def) return;
    setSaving(true); setError("");
    const body = { projectId: project.id, ruleRef, title: meta.title.trim() || def.title, floor: meta.floor, location: meta.location,
      sourceNote: meta.sourceNote, documentId: meta.documentId || null, input: draft, duplicateReason: reason.trim() || null };
    const response = row ? await callApi("/api/takeoffs", "PATCH", { ...body, id: row.id, action: "updateRule" }) : await callApi("/api/takeoffs", "POST", body);
    setSaving(false);
    if (response.status === 409) { setDuplicate(response.data.error ?? "ردیف مشابهی وجود دارد."); return; }
    if (!response.ok) { setError(response.data.error ?? "ثبت انجام نشد."); return; }
    await onSaved(entry.usability.certainty === "provisional"
      ? "مقدار به‌صورت «آزمایشی» ذخیره شد؛ تا تأیید قاعده قابل تأیید قطعی نیست."
      : row ? "ردیف بازمحاسبه شد و برای تأیید دوباره به پیش‌نویس برگشت." : "مقدار با قاعده محاسبه و به‌صورت پیش‌نویس در ریزمتره ثبت شد.");
    onClose();
  };

  return <Modal eyebrow="موتور قواعد متره" title={row ? "بازمحاسبه ردیف با قاعده" : "محاسبه مقدار با قاعده"} size="xl" busy={saving} onClose={onClose} footer={<>
    <button type="button" className="button button-outline" onClick={onClose}>انصراف</button>
    <button type="button" className="button button-primary" data-testid="calc-save" disabled={saving || !preview.result || !project || (!!duplicate && reason.trim().length < 5)} onClick={() => void save()}>
      {saving ? "در حال ثبت..." : duplicate ? "ثبت به‌عنوان ردیف مجزا" : row ? "ذخیره و بازمحاسبه" : "ثبت در ریزمتره (پیش‌نویس)"}</button>
  </>}>
    <div className="calc-grid">
      <div className="calc-form">
        <label className="form-field"><span>قاعده و نسخه</span>
          <select className="input" data-testid="calc-rule" value={ruleRef} onChange={(event) => chooseRule(event.target.value)}>
            {[...new Set(selectable.map((item) => item.definition.operation))].map((operation) => <optgroup key={operation} label={operation}>
              {selectable.filter((item) => item.definition.operation === operation).map((item) => <option key={item.ref} value={item.ref}>{item.definition.title} — {versionLabel(item)}</option>)}
            </optgroup>)}
          </select></label>
        {entry && def && <>
          <div className={`rule-reasons tone-${entry.usability.certainty} slim`}><Info size={16} /><div>
            <p><CertaintyBadge usability={entry.usability} /> {def.measurementRule}</p>
            {entry.usability.certainty === "provisional" && <p>این نسخه تأییدنشده است؛ نتیجه فقط آزمایشی ذخیره می‌شود.</p>}
          </div></div>
          {def.parameters.length > 0 && <><div className="form-section-title">ورودی‌های قاعده</div>
            <div className="form-grid calc-params">{def.parameters.map((p) => <label className="form-field" key={p.key}>
              <span>{p.label} <i>({p.unit})</i></span>
              <input className="input" inputMode="decimal" data-param={p.key} value={draft.values[p.key] ?? ""} onChange={(event) => setValue(p.key, event.target.value)} placeholder={p.default !== undefined ? `پیش‌فرض ${p.default}` : ""} />
              {p.help && <small>{p.help}</small>}
            </label>)}</div></>}
          {(def.lists ?? []).map((list) => <div className="list-editor" key={list.key}>
            <div className="list-editor-head"><div><strong>{list.label}</strong>{list.help && <small>{list.help}</small>}</div>
              <button type="button" className="button button-soft button-sm" data-add-list={list.key} onClick={() => addItem(list.key, list.fields)}><Plus size={14} /> افزودن ردیف</button></div>
            {(draft.lists[list.key] ?? []).length ? <div className="table-scroll"><table><thead><tr>{list.fields.map((field) => <th key={field.key}>{field.label} <i>({field.unit})</i></th>)}<th /></tr></thead><tbody>
              {(draft.lists[list.key] ?? []).map((item, index) => <tr key={index}>
                {list.fields.map((field) => <td key={field.key}><input className="input" inputMode="decimal" aria-label={`${field.label} ردیف ${index + 1}`} data-field={`${list.key}.${index}.${field.key}`}
                  value={item[field.key] ?? ""} onChange={(event) => setItem(list.key, index, field.key, event.target.value)} /></td>)}
                <td><button type="button" className="icon-remove" title="حذف ردیف" onClick={() => removeItem(list.key, index)}><Trash2 size={15} /></button></td>
              </tr>)}
            </tbody></table></div> : <p className="list-empty">ردیفی وارد نشده است؛ کسری برای این فهرست منظور نمی‌شود.</p>}
          </div>)}
          <div className="form-section-title">ثبت در ریزمتره <span>{project ? `پروژه: ${project.name}${project.isDemo ? " (آموزشی)" : ""}` : "پروژه‌ای انتخاب نشده"}</span></div>
          <div className="form-grid">
            <label className="form-field wide"><span>شرح ردیف</span><input className="input" data-testid="calc-title" value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} placeholder={def.title} /></label>
            <label className="form-field"><span>طبقه</span><input className="input" value={meta.floor} onChange={(event) => setMeta({ ...meta, floor: event.target.value })} placeholder="مثلاً همکف" /></label>
            <label className="form-field"><span>محل دقیق</span><input className="input" data-testid="calc-location" value={meta.location} onChange={(event) => setMeta({ ...meta, location: event.target.value })} placeholder="مثلاً محور A تا C" /></label>
            <label className="form-field wide"><span>فایل منبع</span><select className="input" value={meta.documentId} onChange={(event) => setMeta({ ...meta, documentId: event.target.value })}>
              <option value="">بدون فایل پیوست</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.fileName}</option>)}</select></label>
            <label className="form-field wide"><span>منبع اندازه‌گیری / محل روی نقشه</span><textarea className="input" rows={2} data-testid="calc-source" value={meta.sourceNote}
              onChange={(event) => setMeta({ ...meta, sourceNote: event.target.value })} placeholder="برای تأیید ردیف لازم است؛ مثلاً پلان فونداسیون S-02، محور ۱ تا ۳" /></label>
          </div>
        </>}
      </div>

      <aside className="calc-trace" data-testid="calc-trace">
        <h4><Sigma size={16} /> ردیابی محاسبه</h4>
        {preview.result ? <>
          <ol className="step-list compact">{preview.result.trace.map((step, index) => <li key={step.key} className={step.key === def?.result ? "is-result" : ""}>
            <span className="step-index">{fa(index + 1)}</span>
            <div><strong>{step.label}</strong><code className="mono">{step.expression}</code><code className="mono">{step.substituted} = {step.value}</code></div>
          </li>)}</ol>
          <div className="result-box" data-testid="calc-result"><span>نتیجه پس از گرد کردن</span>
            <strong>{fa(preview.result.quantity, 4)} <small>{preview.result.unit}</small></strong>
            <em>مقدار پیش از گرد کردن: <bdi className="mono">{preview.result.unrounded}</bdi> · نیم به بالا تا {fa(preview.result.rounding.scale)} رقم</em></div>
          {preview.result.warnings.map((warning) => <p className="trace-warning" key={warning}><CircleAlert size={14} /> {warning}</p>)}
          {def && def.citations.length > 0 && <p className="trace-source">استناد: {def.citations.map((citation) => `${citation.documentTitle}، ${citation.clause}`).join("؛ ")} — {entry?.sourceVerified ? "سند بازبینی‌شده" : "سند تأییدنشده"}</p>}
        </> : <div className="trace-pending"><FlaskConical size={22} /><p>{preview.error}</p></div>}
        {duplicate && <div className="dup-box"><strong><CircleAlert size={15} /> احتمال محاسبه تکراری</strong><p>{duplicate}</p>
          <input className="input" data-testid="calc-duplicate-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="دلیل ثبت ردیف مشابه (حداقل ۵ نویسه)" /></div>}
        {error && <div className="error-box"><CircleAlert size={16} /> {error}</div>}
      </aside>
    </div>
  </Modal>;
}
