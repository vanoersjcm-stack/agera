import { type FormEvent, useEffect, useState } from 'react';
import { api, type NpsResult, type PortalSurvey, type Survey, type SurveyAnswers, type SurveyAudience, type SurveyQuestion, type SurveyQuestionType, type SurveyStatus } from '../api';
import { activeClients, useClients, useUsers } from '../directory';
import { formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route } from '../router';
import { useShell } from '../shell';
import { currentTier } from '../suites';
import { EnterpriseBadge } from '../symphony/Automations';
import { Drawer, ErrorText, Field, FormActions, Loading, StatusBadge, Tabs, useAction, useLoad } from '../ui';
import { t as tr, tf } from '../i18n';

const SUITE = { label: tr("Nexus"), href: '#/nexus' };
const LIST = { label: tr("Surveys & feedback"), href: '#/nexus/surveys' };
export const QUESTION_TYPE: Record<SurveyQuestionType, string> = {
  nps: tr("Recommendation score (NPS 0–10)"),
  csat: tr("Satisfaction (1–5 stars)"),
  rating: tr("Rating scale"),
  single_choice: tr("Single choice"),
  multi_choice: tr("Multiple choice"),
  text: tr("Open text"),
};
const BASIC: SurveyQuestionType[] = ['nps', 'csat', 'text'];
export const SURVEY_STATUS: Record<SurveyStatus, string> = { draft: tr("Draft"), active: tr("Active"), closed: tr("Closed"), archived: tr("Archived") };
const STATUS_TONE: Record<SurveyStatus, string> = { draft: 'draft', active: 'active', closed: 'closed', archived: 'archived' };

let seq = 0;
const newId = () => `q${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankQuestion = (type: SurveyQuestionType = 'nps'): SurveyQuestion => ({
  id: newId(), type, required: type === 'nps',
  label: type === 'nps' ? tr("How likely are you to recommend us to a colleague?") : type === 'csat' ? tr("How satisfied are you with our service?") : '',
  ...(type === 'single_choice' || type === 'multi_choice' ? { options: ['', ''] } : {}),
  ...(type === 'rating' ? { minRating: 1, maxRating: 10 } : {}),
});

function range(q: SurveyQuestion): [number, number] {
  return q.type === 'nps' ? [0, 10] : q.type === 'csat' ? [1, 5] : [q.minRating ?? 1, q.maxRating ?? 5];
}

function shown(q: SurveyQuestion, answers: SurveyAnswers): boolean {
  if (!q.showIf) return true;
  const a = answers[q.showIf.questionId];
  return a === undefined ? false : Array.isArray(a) ? a.includes(q.showIf.equals) : String(a) === q.showIf.equals;
}

function npsLabel(n: number | null): string {
  return n === null ? '—' : n > 0 ? `+${n}` : String(n);
}

// Designer -----------------------------------------------------------------------------------------------------------

function QuestionEditor({ q, index, all, enterprise, onChange, onMove, onRemove }: {
  q: SurveyQuestion; index: number; all: SurveyQuestion[]; enterprise: boolean;
  onChange: (q: SurveyQuestion) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const earlier = all.slice(0, index).filter((x) => x.type !== 'text');
  const types = (Object.keys(QUESTION_TYPE) as SurveyQuestionType[]);
  return (
    <fieldset className="survey-question">
      <legend>
        {tf("Question {n}", { n: index + 1 })}
        <span className="survey-q-tools">
          <button type="button" className="link-button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={tr("Move up")}>↑</button>
          <button type="button" className="link-button" disabled={index === all.length - 1} onClick={() => onMove(1)} aria-label={tr("Move down")}>↓</button>
          <button type="button" className="link-button danger" onClick={onRemove}>{tr("Remove")}</button>
        </span>
      </legend>
      <div className="step-row">
        <select aria-label={tr("Question type")} value={q.type} onChange={(e) => onChange({ ...blankQuestion(e.target.value as SurveyQuestionType), id: q.id, label: q.label || blankQuestion(e.target.value as SurveyQuestionType).label })}>
          {types.map((t) => <option key={t} value={t} disabled={!enterprise && !BASIC.includes(t)}>{QUESTION_TYPE[t]}{!enterprise && !BASIC.includes(t) ? ` (${tr("Enterprise")})` : ''}</option>)}
        </select>
        <label className="inline-label"><input type="checkbox" checked={q.required} onChange={(e) => onChange({ ...q, required: e.target.checked })} /> {tr("Required")}</label>
      </div>
      <input aria-label={tr("Question")} required maxLength={300} placeholder={tr("Question text")} value={q.label} onChange={(e) => onChange({ ...q, label: e.target.value })} />
      {(q.type === 'single_choice' || q.type === 'multi_choice') && (
        <div className="survey-options">
          {(q.options ?? []).map((o, i) => (
            <div key={i} className="step-row">
              <input aria-label={tf("Option {n}", { n: i + 1 })} required maxLength={200} placeholder={tf("Option {n}", { n: i + 1 })} value={o} onChange={(e) => onChange({ ...q, options: q.options!.map((x, j) => (j === i ? e.target.value : x)) })} />
              {(q.options ?? []).length > 2 && <button type="button" className="link-button danger" onClick={() => onChange({ ...q, options: q.options!.filter((_, j) => j !== i) })}>{tr("Remove")}</button>}
            </div>
          ))}
          {(q.options ?? []).length < 20 && <button type="button" className="secondary small" onClick={() => onChange({ ...q, options: [...(q.options ?? []), ''] })}>{tr("+ Add option")}</button>}
        </div>
      )}
      {q.type === 'rating' && (
        <div className="step-row">
          <label className="inline-label">{tr("From")} <input type="number" min={0} max={9} value={q.minRating ?? 1} onChange={(e) => onChange({ ...q, minRating: Number(e.target.value) })} /></label>
          <label className="inline-label">{tr("to")} <input type="number" min={1} max={10} value={q.maxRating ?? 5} onChange={(e) => onChange({ ...q, maxRating: Number(e.target.value) })} /></label>
        </div>
      )}
      {index > 0 && (
        <div className="step-row">
          <label className="inline-label">
            <input type="checkbox" disabled={!enterprise || earlier.length === 0} checked={!!q.showIf} onChange={(e) => onChange({ ...q, showIf: e.target.checked ? { questionId: earlier[earlier.length - 1].id, equals: '' } : null })} /> {tr("Only show if")}
          </label>
          {q.showIf && (
            <>
              <select aria-label={tr("Earlier question")} value={q.showIf.questionId} onChange={(e) => onChange({ ...q, showIf: { questionId: e.target.value, equals: '' } })}>
                {earlier.map((x) => <option key={x.id} value={x.id}>{x.label || tr("(untitled question)")}</option>)}
              </select>
              <span>{tr("is")}</span>
              {(() => {
                const ref = all.find((x) => x.id === q.showIf!.questionId);
                if (ref?.options) return <select aria-label={tr("Answer")} required value={q.showIf.equals} onChange={(e) => onChange({ ...q, showIf: { ...q.showIf!, equals: e.target.value } })}><option value="">{tr("Choose…")}</option>{ref.options.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
                return <input aria-label={tr("Answer")} required placeholder={tr("answer, e.g. 3")} value={q.showIf.equals} onChange={(e) => onChange({ ...q, showIf: { ...q.showIf!, equals: e.target.value } })} />;
              })()}
            </>
          )}
          {!enterprise && <EnterpriseBadge />}
        </div>
      )}
    </fieldset>
  );
}

export function QuestionInput({ q, value, onChange }: { q: SurveyQuestion; value: SurveyAnswers[string] | undefined; onChange: (v: SurveyAnswers[string] | undefined) => void }) {
  if (q.type === 'text') return <textarea rows={3} maxLength={5000} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={q.label} />;
  if (q.type === 'single_choice') {
    return <div className="survey-choices">{(q.options ?? []).map((o) => <label key={o} className="inline-label"><input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} /> {o}</label>)}</div>;
  }
  if (q.type === 'multi_choice') {
    const list = (value as string[]) ?? [];
    return <div className="survey-choices">{(q.options ?? []).map((o) => <label key={o} className="inline-label"><input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}</label>)}</div>;
  }
  const [lo, hi] = range(q);
  const nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className={`survey-scale${q.type === 'csat' ? ' stars' : ''}`} role="radiogroup" aria-label={q.label}>
      {nums.map((n) => (
        <button type="button" key={n} role="radio" aria-checked={value === n} className={value === n || (q.type === 'csat' && typeof value === 'number' && n <= value) ? 'selected' : undefined} onClick={() => onChange(n)}>
          {q.type === 'csat' ? '★' : n}
        </button>
      ))}
      {q.type === 'nps' && <div className="survey-scale-legend"><span>{tr("Not likely")}</span><span>{tr("Very likely")}</span></div>}
    </div>
  );
}

/** The questionnaire as a client sees it; used for the designer preview and the client portal. */
export function Questionnaire({ survey, busy, onSubmit, preview, hideTitle }: { survey: { title: string; description: string | null; questions: SurveyQuestion[] }; busy?: boolean; onSubmit?: (a: SurveyAnswers) => void; preview?: boolean; hideTitle?: boolean }) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [missing, setMissing] = useState<string | null>(null);
  const visible = survey.questions.filter((q) => shown(q, answers));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const gap = visible.find((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && (answers[q.id] as string[]).length === 0)));
    if (gap) return setMissing(tf("“{q}” needs an answer", { q: gap.label }));
    setMissing(null);
    const clean: SurveyAnswers = {};
    for (const q of visible) if (answers[q.id] !== undefined) clean[q.id] = answers[q.id];
    onSubmit?.(clean);
  };
  return (
    <form className="questionnaire" onSubmit={submit}>
      {!hideTitle && <h2>{survey.title || tr("(untitled survey)")}</h2>}
      {survey.description && <p className="muted">{survey.description}</p>}
      {visible.map((q, i) => (
        <div key={q.id} className="questionnaire-q">
          <label>{i + 1}. {q.label || tr("(untitled question)")} {q.required && <span className="required" aria-label={tr("required")}>*</span>}</label>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => { const n = { ...a }; if (v === undefined) delete n[q.id]; else n[q.id] = v; return n; })} />
        </div>
      ))}
      <ErrorText error={missing} />
      <button className="primary wide" type="submit" disabled={busy || preview}>{preview ? tr("Send answers (preview)") : tr("Send answers")}</button>
    </form>
  );
}

function SurveyDesigner({ survey, onSaved }: { survey: Survey; onSaved: () => void }) {
  const { notify } = useShell();
  const enterprise = currentTier() === 'symphony';
  const [title, setTitle] = useState(survey.title);
  const [description, setDescription] = useState(survey.description ?? '');
  const [questions, setQuestions] = useState<SurveyQuestion[]>(survey.questions);
  const [preview, setPreview] = useState<'off' | 'mobile' | 'portal'>('off');
  const action = useAction();
  const draft = survey.status === 'draft';
  const body = () => ({ title: title.trim(), description: description.trim() || null, ...(draft ? { questions } : {}) });
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    void action.run(() => api.updateSurvey(survey.id, body())).then((r) => r && (notify(tr("Survey saved")), onSaved()));
  };
  const activate = () => {
    void action.run(async () => { await api.updateSurvey(survey.id, body()); return api.setSurveyStatus(survey.id, 'active'); }).then((r) => r && (notify(tr("Survey activated")), onSaved()));
  };
  const move = (i: number, dir: -1 | 1) => setQuestions((qs) => { const n = [...qs]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });
  return (
    <div className={`survey-designer${preview !== 'off' ? ' with-preview' : ''}`}>
      <form onSubmit={save} className="card-panel">
        <Field label={tr("Title")}><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={tr("Introduction")} hint={tr("Shown above the questions")}><textarea rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {!draft && <p className="callout">{tr("Questions are locked once a survey has been activated, so answers stay comparable.")}</p>}
        {draft ? (
          <>
            {questions.map((q, i) => (
              <QuestionEditor key={q.id} q={q} index={i} all={questions} enterprise={enterprise}
                onChange={(n) => setQuestions(questions.map((x) => (x.id === q.id ? n : x)))}
                onMove={(d) => move(i, d)} onRemove={() => setQuestions(questions.filter((x) => x.id !== q.id))} />
            ))}
            <div className="step-row">
              <button type="button" className="secondary small" disabled={questions.length >= 50} onClick={() => setQuestions([...questions, blankQuestion(questions.some((q) => q.type === 'nps') ? 'csat' : 'nps')])}>{tr("+ Add question")}</button>
              <button type="button" className="secondary small" onClick={() => setQuestions([...questions, blankQuestion('text')])}>{tr("+ Open question")}</button>
              {!enterprise && <span className="muted small">{tr("Agera Vanguard: NPS, satisfaction and open questions.")} <EnterpriseBadge /></span>}
            </div>
          </>
        ) : (
          <ol className="survey-readonly">{survey.questions.map((q) => <li key={q.id}>{q.label} <span className="muted small">· {QUESTION_TYPE[q.type]}{q.required ? ` · ${tr("required")}` : ''}{q.showIf ? ` · ${tr("conditional")}` : ''}</span></li>)}</ol>
        )}
        <ErrorText error={action.error} />
        <div className="form-actions">
          <div className="segmented" role="group" aria-label={tr("Preview")}>
            {(['off', 'mobile', 'portal'] as const).map((p) => <button type="button" key={p} className={preview === p ? 'active' : undefined} onClick={() => setPreview(p)}>{p === 'off' ? tr("No preview") : p === 'mobile' ? tr("Mobile preview") : tr("Portal preview")}</button>)}
          </div>
          <button type="submit" className="secondary" disabled={action.busy}>{draft ? tr("Save draft") : tr("Save")}</button>
          {draft && <button type="button" className="primary" disabled={action.busy || questions.length === 0} onClick={activate}>{tr("Activate survey")}</button>}
        </div>
      </form>
      {preview !== 'off' && (
        <div className={`survey-preview ${preview}`} aria-label={tr("Preview")}>
          <Questionnaire preview survey={{ title, description: description || null, questions: draft ? questions : survey.questions }} />
        </div>
      )}
    </div>
  );
}

// Dispatch -----------------------------------------------------------------------------------------------------------

function SurveyDispatchModal({ survey, onClose, onSent }: { survey: Survey; onClose: () => void; onSent: () => void }) {
  const { notify } = useShell();
  const enterprise = currentTier() === 'symphony';
  const clients = activeClients(useClients());
  const users = useUsers();
  const rooms = useLoad(() => api.rooms(), []);
  const [mode, setMode] = useState<SurveyAudience['targetType']>('single_client');
  const [clientId, setClientId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [all, setAll] = useState(true);
  const [sector, setSector] = useState('');
  const [minArr, setMinArr] = useState('');
  const [maxArr, setMaxArr] = useState('');
  const [manager, setManager] = useState('');
  const [maxHealth, setMaxHealth] = useState('');
  const [count, setCount] = useState<{ clients: number; contacts: number; sectors: string[] } | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const action = useAction();
  const audience: SurveyAudience = mode === 'single_client' ? { targetType: mode, clientId: clientId || null }
    : mode === 'client_room' ? { targetType: mode, clientRoomId: roomId || null }
    : all ? { targetType: mode, all: true }
    : { targetType: mode, sector: sector || null, minArr: minArr ? Number(minArr) : null, maxArr: maxArr ? Number(maxArr) : null, accountManagerId: manager || null, maxHealthScore: maxHealth ? Number(maxHealth) : null };
  const key = JSON.stringify(audience);
  useEffect(() => {
    const ready = (mode === 'single_client' && clientId) || (mode === 'client_room' && roomId) || (mode === 'client_cohort' && (all || sector || minArr || maxArr || manager || maxHealth));
    if (!ready) { setCount(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      api.surveyAudience(audience).then((c) => live && (setCount(c), setCountError(null)), (e: Error) => live && (setCount(null), setCountError(e.message)));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [sectors, setSectors] = useState<string[]>([]);
  useEffect(() => { void api.surveyAudience({ targetType: 'client_cohort', all: true }).then((c) => setSectors(c.sectors), () => undefined); }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => api.dispatchSurvey(survey.id, audience)).then((r) => r && (notify(tf("Survey sent to {n} client companies", { n: r.totalTargeted })), onSent()));
  };
  const activeRooms = (rooms.data ?? []).filter((r) => r.status === 'active');
  return (
    <Drawer title={tf("Send “{title}”", { title: survey.title })} onClose={onClose}>
      <form onSubmit={submit}>
        <Tabs active={mode} onChange={(m) => setMode(m as SurveyAudience['targetType'])} tabs={[
          { id: 'single_client', label: tr("Single client") },
          { id: 'client_cohort', label: tr("Cohort") },
          { id: 'client_room', label: tr("In a client room") },
        ]} />
        {mode === 'single_client' && (
          <Field label={tr("Client company")}>
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{tr("Choose a client…")}</option>
              {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {mode === 'client_room' && (
          <Field label={tr("Client room")} hint={tr("The survey appears as a card inside this room in the client portal")}>
            <select required value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{tr("Choose a client room…")}</option>
              {activeRooms.map((r) => <option key={r.id} value={r.id}>{r.roomName}</option>)}
            </select>
          </Field>
        )}
        {mode === 'client_cohort' && (
          <>
            <label className="inline-label"><input type="radio" checked={all} onChange={() => setAll(true)} /> {tr("All active clients")}</label>
            <label className="inline-label"><input type="radio" checked={!all} disabled={!enterprise} onChange={() => setAll(false)} /> {tr("Clients matching filters")} {!enterprise && <EnterpriseBadge />}</label>
            {!all && (
              <div className="form-grid">
                <Field label={tr("Sector")}><select value={sector} onChange={(e) => setSector(e.target.value)}><option value="">{tr("Any sector")}</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
                <Field label={tr("Account manager")}><select value={manager} onChange={(e) => setManager(e.target.value)}><option value="">{tr("Anyone")}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></Field>
                <Field label={tr("Minimum ARR (€)")} hint={tr("Annual value of active agreements")}><input type="number" min={0} value={minArr} onChange={(e) => setMinArr(e.target.value)} /></Field>
                <Field label={tr("Maximum ARR (€)")}><input type="number" min={0} value={maxArr} onChange={(e) => setMaxArr(e.target.value)} /></Field>
                <Field label={tr("Health score at most")} hint={tr("e.g. 70 to reach clients that need attention")}><input type="number" min={0} max={100} value={maxHealth} onChange={(e) => setMaxHealth(e.target.value)} /></Field>
              </div>
            )}
          </>
        )}
        <p className="audience-count" aria-live="polite">
          {count ? tf("Matches {clients} client companies ({contacts} contacts)", { clients: count.clients, contacts: count.contacts }) : countError ?? tr("Choose who should receive the survey")}
        </p>
        <p className="muted small">{tr("Clients answer in the client portal. Sending by e-mail is not connected yet.")}</p>
        <ErrorText error={action.error} />
        <FormActions busy={action.busy} submitLabel={tr("Send survey")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

// Analytics ----------------------------------------------------------------------------------------------------------

export function NpsGauge({ nps }: { nps: NpsResult }) {
  const pct = (n: number) => (nps.count ? (100 * n) / nps.count : 0);
  return (
    <div className="nps-gauge">
      <div className="nps-bar" aria-hidden>
        <span className="det" style={{ width: `${pct(nps.detractors)}%` }} />
        <span className="pas" style={{ width: `${pct(nps.passives)}%` }} />
        <span className="pro" style={{ width: `${pct(nps.promoters)}%` }} />
      </div>
      <div className="nps-legend small">
        <span><i className="det" /> {tf("Detractors (0–6): {n}", { n: nps.detractors })}</span>
        <span><i className="pas" /> {tf("Passives (7–8): {n}", { n: nps.passives })}</span>
        <span><i className="pro" /> {tf("Promoters (9–10): {n}", { n: nps.promoters })}</span>
      </div>
    </div>
  );
}

function Bars({ distribution }: { distribution: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(distribution));
  return (
    <div className="bars">
      {Object.entries(distribution).map(([k, v]) => (
        <div key={k} className="bar-row"><span className="bar-label">{k}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(100 * v) / max}%` }} /></span><span className="bar-value">{v}</span></div>
      ))}
    </div>
  );
}

function SurveyAnalyticsView({ survey }: { survey: Survey }) {
  const enterprise = currentTier() === 'symphony';
  const users = useUsers();
  const [sector, setSector] = useState('');
  const [manager, setManager] = useState('');
  const data = useLoad(() => api.surveyAnalytics(survey.id, { sector: sector || undefined, accountManagerId: manager || undefined }), [survey.id, sector, manager]);
  const a = data.data;
  const action = useAction();
  return (
    <>
      <div className="step-row analytics-filters">
        <select aria-label={tr("Sector")} disabled={!enterprise} value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">{tr("All sectors")}</option>
          {(a?.bySector ?? []).filter((s) => s.name !== 'No sector').map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          {sector && !a?.bySector.some((s) => s.name === sector) && <option value={sector}>{sector}</option>}
        </select>
        <select aria-label={tr("Account manager")} disabled={!enterprise} value={manager} onChange={(e) => setManager(e.target.value)}>
          <option value="">{tr("All account managers")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        {!enterprise && <EnterpriseBadge />}
        <button className="secondary small" disabled={action.busy} onClick={() => void action.run(() => api.exportSurvey(survey.id, survey.title))}>{tr("Export CSV")}</button>
      </div>
      <ErrorText error={action.error} />
      {!a && <Loading error={data.error} />}
      {a && (
        <>
          <div className="kpi-grid">
            <div className="kpi kpi-indigo"><span>{tr("Total responses")}</span><strong>{a.totalResponses}</strong></div>
            <div className="kpi kpi-blue"><span>{tr("Response rate")}</span><strong>{a.responseRate === null ? '—' : `${a.responseRate}%`}</strong><small className="muted">{tf("{r} of {t} client companies", { r: a.respondedClients, t: a.targetedClients })}</small></div>
            <div className="kpi kpi-emerald"><span>{tr("NPS")}</span><strong>{npsLabel(a.nps.score)}</strong></div>
          </div>
          {a.nps.count > 0 && <NpsGauge nps={a.nps} />}
          {a.totalResponses === 0 && <EmptyState title={tr("No responses yet")}>{tr("Responses appear here as soon as clients answer in the client portal.")}</EmptyState>}
          {a.totalResponses > 0 && (
            <>
              <div className="analytics-grid">
                {a.questions.map((q) => (
                  <div key={q.id} className="card-panel">
                    <h3>{q.label}</h3>
                    <p className="muted small">{QUESTION_TYPE[q.type]} · {tf("{n} answered", { n: q.answered })}{q.average != null ? ` · ${tf("average {n}", { n: q.average })}` : ''}</p>
                    {q.distribution && <Bars distribution={q.distribution} />}
                    {q.texts && (q.texts.length ? <ul className="survey-texts">{q.texts.slice(0, 20).map((t, i) => <li key={i}>“{t}”</li>)}</ul> : <p className="muted small">{tr("No answers")}</p>)}
                  </div>
                ))}
              </div>
              <div className="analytics-grid">
                <div className="card-panel"><h3>{tr("By sector")}</h3><table className="grid"><thead><tr><th>{tr("Sector")}</th><th className="num">{tr("Responses")}</th><th className="num">{tr("NPS")}</th></tr></thead><tbody>{a.bySector.map((r) => <tr key={r.name}><td>{tr(r.name)}</td><td className="num">{r.responses}</td><td className="num">{npsLabel(r.nps)}</td></tr>)}</tbody></table></div>
                <div className="card-panel"><h3>{tr("By account manager")}</h3><table className="grid"><thead><tr><th>{tr("Account manager")}</th><th className="num">{tr("Responses")}</th><th className="num">{tr("NPS")}</th></tr></thead><tbody>{a.byAccountManager.map((r) => <tr key={r.name}><td>{tr(r.name)}</td><td className="num">{r.responses}</td><td className="num">{npsLabel(r.nps)}</td></tr>)}</tbody></table></div>
              </div>
              <h2 className="section-title">{tr("Respondents")}</h2>
              <table className="grid">
                <thead><tr><th>{tr("Client")}</th><th>{tr("Contact")}</th><th>{tr("Submitted")}</th><th className="num">{tr("NPS")}</th></tr></thead>
                <tbody>
                  {a.respondents.map((r) => (
                    <tr key={r.id}>
                      <td>{r.clientId ? <a href={`#/symphony/clients/${r.clientId}`}>{r.clientName}</a> : '—'}</td>
                      <td>{r.contactName || r.respondentEmail || '—'}</td>
                      <td>{formatDateTime(r.submittedAt)}</td>
                      <td className="num">{r.npsScore ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="muted small">{tr("Scheduled digest e-mails: not connected (needs an e-mail connection under Symphony › External systems).")}</p>
        </>
      )}
    </>
  );
}

// Pages --------------------------------------------------------------------------------------------------------------

export function NewSurveyForm({ onDone, onCancel }: { onDone: (route?: string, message?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const action = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => api.createSurvey({ title: title.trim(), questions: [blankQuestion('nps'), blankQuestion('text')].map((q, i) => (i === 1 ? { ...q, label: tr("What could we do better?") } : q)) }))
      .then((s) => s && onDone(`/nexus/surveys/${s.id}`, tr("Survey draft created")));
  };
  return (
    <form onSubmit={submit}>
      <Field label={tr("Title")} hint={tr("You add and arrange the questions on the next screen")}><input required autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("e.g. Quarterly client satisfaction")} /></Field>
      <ErrorText error={action.error} />
      <FormActions busy={action.busy} submitLabel={tr("Create survey")} onCancel={onCancel} />
    </form>
  );
}

export function SurveysView({ route: _route }: { route: Route }) {
  const { openNew } = useShell();
  const list = useLoad(() => api.surveys(), []);
  const l = list.data;
  const full = !!l && l.maxActive !== null && l.activeCount >= l.maxActive;
  return (
    <ViewFrame title={tr("Surveys & feedback")} subtitle={tr("Questionnaires for your clients, answered in the client portal")} crumbs={[SUITE, { label: tr("Surveys & feedback") }]}
      actions={<button className="primary" onClick={() => openNew('survey')}>{tr("+ New survey")}</button>}>
      {l && (
        <p className={`edition-limit${full ? ' full' : ''}`}>
          {l.maxActive === null
            ? <>{tr("Agera Symphony: unlimited surveys, all question types, branching and cohorts.")} <strong>{l.activeCount}</strong> {tr("active.")}</>
            : <><strong>{tf("{a} of {m}", { a: l.activeCount, m: l.maxActive })}</strong> {tr("active surveys (Agera Vanguard: NPS, satisfaction and open questions; one client or all clients).")} {full && tr("Close one to activate another.")} <EnterpriseBadge /></>}
        </p>
      )}
      {!l && <Loading error={list.error} />}
      {l?.items.length === 0 && <EmptyState title={tr("No surveys yet")} action={<button className="primary" onClick={() => openNew('survey')}>{tr("+ New survey")}</button>}>{tr("Create a survey, send it to one client or a group, and follow the answers here.")}</EmptyState>}
      {l && l.items.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{tr("Survey")}</th><th>{tr("Status")}</th><th className="num">{tr("Questions")}</th><th className="num">{tr("Clients reached")}</th><th className="num">{tr("Responses")}</th><th className="num">{tr("NPS")}</th><th>{tr("Updated")}</th></tr></thead>
          <tbody>
            {l.items.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/nexus/surveys/${s.id}`)}>
                <td><a href={`#/nexus/surveys/${s.id}`}>{s.title}</a></td>
                <td><StatusBadge status={STATUS_TONE[s.status]} label={SURVEY_STATUS[s.status]} /></td>
                <td className="num">{s.questions.length}</td>
                <td className="num">{s.targetedClients}</td>
                <td className="num">{s.responseCount}</td>
                <td className="num">{npsLabel(s.nps)}</td>
                <td>{formatDateTime(s.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function SurveyDossier({ id, route }: { id: string; route: Route }) {
  const { notify } = useShell();
  const survey = useLoad(() => api.survey(id), [id]);
  const [sending, setSending] = useState(false);
  const action = useAction();
  const s = survey.data;
  const tab = route.params.get('tab') ?? (s && s.status !== 'draft' ? 'analytics' : 'design');
  const setTab = (t: string) => navigate(`/nexus/surveys/${id}?tab=${t}`);
  if (!s) return <ViewFrame title={tr("Survey")} crumbs={[SUITE, LIST, { label: tr("Loading…") }]}><Loading error={survey.error} /></ViewFrame>;
  const status = (next: SurveyStatus, message: string) => void action.run(() => api.setSurveyStatus(id, next)).then((r) => r && (notify(message), survey.reload()));
  return (
    <ViewFrame title={s.title} subtitle={<StatusBadge status={STATUS_TONE[s.status]} label={SURVEY_STATUS[s.status]} />} crumbs={[SUITE, LIST, { label: s.title }]}
      actions={<>
        {s.status === 'active' && <button className="primary" onClick={() => setSending(true)}>{tr("Send survey…")}</button>}
        {s.status === 'active' && <button className="secondary" onClick={() => window.confirm(tr("Close this survey? Clients can no longer answer it.")) && status('closed', tr("Survey closed"))}>{tr("Close survey")}</button>}
        {s.status === 'closed' && <button className="secondary" onClick={() => status('active', tr("Survey reopened"))}>{tr("Reopen")}</button>}
        {(s.status === 'closed' || s.status === 'draft') && <button className="secondary" onClick={() => window.confirm(tr("Archive this survey?")) && status('archived', tr("Survey archived"))}>{tr("Archive")}</button>}
      </>}>
      <ErrorText error={action.error} />
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'design', label: tr("Questions") }, { id: 'dispatches', label: tf("Sent ({n})", { n: s.dispatches?.length ?? 0 }) }, { id: 'analytics', label: tf("Results ({n})", { n: s.responseCount }) }]} />
      {tab === 'design' && <SurveyDesigner key={s.updatedAt} survey={s} onSaved={survey.reload} />}
      {tab === 'dispatches' && (
        (s.dispatches ?? []).length === 0
          ? <EmptyState title={tr("Not sent yet")} action={s.status === 'active' ? <button className="primary" onClick={() => setSending(true)}>{tr("Send survey…")}</button> : undefined}>{s.status === 'draft' ? tr("Activate the survey on the Questions tab, then send it.") : tr("Send it to one client, a client room or a group of clients.")}</EmptyState>
          : <table className="grid">
              <thead><tr><th>{tr("Sent")}</th><th>{tr("To")}</th><th className="num">{tr("Client companies")}</th><th className="num">{tr("Contacts")}</th><th className="num">{tr("Responses")}</th><th>{tr("By")}</th></tr></thead>
              <tbody>
                {s.dispatches!.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDateTime(d.createdAt)}</td>
                    <td>{d.targetType === 'single_client' ? d.clientName : d.targetType === 'client_room' ? tf("Client room {name}", { name: d.clientRoomName ?? '' }) : d.filterCriteria && 'all' in d.filterCriteria ? tr("All active clients") : tf("Cohort: {f}", { f: Object.entries(d.filterCriteria ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') })}</td>
                    <td className="num">{d.totalTargeted}</td><td className="num">{d.totalContacts}</td><td className="num">{d.totalResponded}</td><td>{d.dispatchedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
      )}
      {tab === 'analytics' && <SurveyAnalyticsView key={`${s.updatedAt}-${s.dispatches?.length ?? 0}-${s.responseCount}`} survey={s} />}
      {sending && <SurveyDispatchModal survey={s} onClose={() => setSending(false)} onSent={() => { setSending(false); survey.reload(); }} />}
    </ViewFrame>
  );
}

/** Symphony › Customer feedback: executive roll-up over all surveys. */
export function FeedbackView() {
  const data = useLoad(() => api.feedbackSummary(), []);
  const f = data.data;
  return (
    <ViewFrame title={tr("Customer feedback")} subtitle={tr("Recommendation score (NPS) from client surveys over the last 90 days")} crumbs={[{ label: tr("Symphony"), href: '#/symphony' }, { label: tr("Customer feedback") }]}
      actions={<a className="button secondary" href="#/nexus/surveys">{tr("Manage surveys")}</a>}>
      {!f && <Loading error={data.error} />}
      {f && (
        <>
          <div className="kpi-grid">
            <div className="kpi kpi-emerald"><span>{tr("NPS (90 days)")}</span><strong>{npsLabel(f.nps.score)}</strong></div>
            <div className="kpi kpi-indigo"><span>{tr("Responses")}</span><strong>{f.responses}</strong></div>
            <div className="kpi kpi-blue"><span>{tr("Clients that answered")}</span><strong>{f.clients.length}</strong></div>
          </div>
          {f.nps.count > 0 && <NpsGauge nps={f.nps} />}
          {f.responses === 0 && <EmptyState title={tr("No feedback in the last 90 days")} action={<a className="button primary" href="#/nexus/surveys">{tr("Go to surveys")}</a>}>{tr("Send a survey under Nexus › Surveys & feedback; answers from the client portal appear here.")}</EmptyState>}
          {f.clients.length > 0 && (
            <>
              <h2 className="section-title">{tr("Clients, lowest score first")}</h2>
              <table className="grid">
                <thead><tr><th>{tr("Client")}</th><th className="num">{tr("Responses")}</th><th className="num">{tr("NPS")}</th><th className="num">{tr("Average score")}</th><th>{tr("Last answer")}</th></tr></thead>
                <tbody>{f.clients.map((c) => <tr key={c.clientId}><td><a href={`#/symphony/clients/${c.clientId}`}>{c.name}</a></td><td className="num">{c.responses}</td><td className="num">{npsLabel(c.nps)}</td><td className="num">{c.averageScore ?? '—'}</td><td>{formatDateTime(c.lastAt)}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {f.surveys.length > 0 && (
            <>
              <h2 className="section-title">{tr("Surveys")}</h2>
              <table className="grid clickable">
                <thead><tr><th>{tr("Survey")}</th><th>{tr("Status")}</th><th className="num">{tr("Responses")}</th><th className="num">{tr("NPS")}</th></tr></thead>
                <tbody>{f.surveys.map((s) => <tr key={s.id} onClick={() => navigate(`/nexus/surveys/${s.id}?tab=analytics`)}><td><a href={`#/nexus/surveys/${s.id}?tab=analytics`}>{s.title}</a></td><td><StatusBadge status={STATUS_TONE[s.status]} label={SURVEY_STATUS[s.status]} /></td><td className="num">{s.responseCount}</td><td className="num">{npsLabel(s.nps)}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </ViewFrame>
  );
}

// Client portal ------------------------------------------------------------------------------------------------------

function Confetti() {
  const colors = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9'];
  return <div className="confetti" aria-hidden>{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 10) * 0.08}s` }} />)}</div>;
}

/** "Feedback requested" cards for the portal overview and client rooms. */
export function PortalSurveyCards({ roomId }: { roomId?: string }) {
  const list = useLoad(() => api.portalSurveys(), []);
  const open = (list.data ?? []).filter((s) => !s.answered && (!roomId || s.clientRoomIds.includes(roomId)));
  if (open.length === 0) return null;
  return (
    <div className="feedback-cards">
      {open.map((s) => (
        <a key={s.id} className="feedback-card" href={`#/portal/surveys/${s.id}`}>
          <strong>{tf("Feedback requested: {title}", { title: s.title })}</strong>
          <span>{tf("{n} questions · takes about a minute", { n: s.questions.length })}</span>
        </a>
      ))}
    </div>
  );
}

export function PortalSurveysView({ id }: { id?: string }) {
  const list = useLoad(() => api.portalSurveys(), []);
  const [done, setDone] = useState(false);
  const action = useAction();
  const crumbs = [{ label: tr("Client portal"), href: '#/portal' }, { label: tr("Surveys"), href: '#/portal/surveys' }];
  if (!list.data) return <ViewFrame title={tr("Surveys")} crumbs={crumbs}><Loading error={list.error} /></ViewFrame>;
  const survey: PortalSurvey | undefined = id ? list.data.find((s) => s.id === id) : undefined;
  if (id) {
    if (!survey) return <ViewFrame title={tr("Survey")} crumbs={crumbs}><EmptyState title={tr("This survey is no longer open")}>{tr("It may have been closed. Thank you for your interest.")}</EmptyState></ViewFrame>;
    if (done || survey.answered) {
      return (
        <ViewFrame title={survey.title} crumbs={[...crumbs, { label: survey.title }]}>
          {done && <Confetti />}
          <div className="survey-thanks card-panel"><h2>{tr("Thank you for your feedback!")}</h2><p>{tr("Your answers have been sent. They help us serve you better.")}</p><a className="button secondary" href="#/portal">{tr("Back to overview")}</a></div>
        </ViewFrame>
      );
    }
    return (
      <ViewFrame title={survey.title} crumbs={[...crumbs, { label: survey.title }]}>
        <div className="portal-survey">
          <Questionnaire hideTitle survey={survey} busy={action.busy} onSubmit={(answers) => void action.run(() => api.respondSurvey(survey.id, answers as SurveyAnswers)).then((r) => r && setDone(true))} />
          <ErrorText error={action.error} />
        </div>
      </ViewFrame>
    );
  }
  return (
    <ViewFrame title={tr("Surveys")} subtitle={tr("Questions from Agera about our service")} crumbs={crumbs}>
      {list.data.length === 0 && <EmptyState title={tr("No surveys for you right now")}>{tr("When Agera asks for your feedback, the survey appears here.")}</EmptyState>}
      <ul className="link-list">
        {list.data.map((s) => <li key={s.id}><a href={`#/portal/surveys/${s.id}`}>{s.title}</a> {s.answered ? <StatusBadge status="active" label={tr("Answered")} /> : <StatusBadge status="draft" label={tr("Open")} />}</li>)}
      </ul>
    </ViewFrame>
  );
}
