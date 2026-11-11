import { useState } from 'react';
import { api, type DocumentClass, type ErasureMode, type IdmsKind, type IdmsStatus, type RetentionPolicy, type RetentionRun } from './api';
import { userContext, type UserContext } from './context';
import { formatDateTime } from './labels';
import { ViewFrame } from './Layout';
import { useShell } from './shell';
import { ErrorText, Loading, useAction, useLoad } from './ui';
import { live, t, tf } from './i18n';

export const IDMS_LABEL: Record<IdmsStatus, string> = live(() => ({
  DRAFT: t("Draft"),
  IN_REVIEW: t("In review"),
  FINAL_LOCKED: t("Final (locked)"),
  ARCHIVED_WORM: t("Archived (WORM)"),
  EXPIRED_PURGE: t("Expired (erased)"),
}));

const TONE: Record<IdmsStatus, string> = { DRAFT: 'neutral', IN_REVIEW: 'warn', FINAL_LOCKED: 'good', ARCHIVED_WORM: 'muted', EXPIRED_PURGE: 'bad' };

const HINT: Record<IdmsStatus, string> = live(() => ({
  DRAFT: t("Lifecycle: draft, still editable"),
  IN_REVIEW: t("Lifecycle: in review, still editable"),
  FINAL_LOCKED: t("Lifecycle: final; the content is locked and opens read-only"),
  ARCHIVED_WORM: t("Lifecycle: archived (write once, read many); nothing can change until the retention period ends"),
  EXPIRED_PURGE: t("Lifecycle: retention period ended; personal data has been erased"),
}));

/** The single forward step each status allows from the UI; EXPIRED_PURGE is set only by the retention job. */
const NEXT: Partial<Record<IdmsStatus, { to: IdmsStatus; label: string; confirm?: string }>> = live(() => ({
  DRAFT: { to: 'IN_REVIEW', label: t("Submit for review") },
  IN_REVIEW: { to: 'FINAL_LOCKED', label: t("Lock final"), confirm: t("Lock this record as final? Its content can no longer be changed, and this cannot be undone.") },
  FINAL_LOCKED: { to: 'ARCHIVED_WORM', label: t("Archive (WORM)"), confirm: t("Archive this record? It becomes write-once/read-many until its retention period ends. This cannot be undone.") },
}));

export const isLocked = (status: IdmsStatus | undefined) => status === 'FINAL_LOCKED' || status === 'ARCHIVED_WORM' || status === 'EXPIRED_PURGE';

/** Account managers move documents and agreements; HQ and platform admins every kind; field and client roles none. */
export function canTransition(user: UserContext, kind: IdmsKind): boolean {
  if (user.scope === 'external') return false;
  switch (user.jobRole) {
    case null:
    case 'PLATFORM_ADMIN':
    case 'HQ_ADMIN':
      return true;
    case 'ACCOUNT_MANAGER':
      return kind === 'documents' || kind === 'agreements';
    default:
      return false;
  }
}

/** HQ and platform admins (and legacy administrators) manage retention rules. */
export function canManageRetention(user: UserContext): boolean {
  if (user.scope === 'external') return false;
  if (user.jobRole === null) return user.role === 'admin' || user.isPlatformAdmin;
  return user.jobRole === 'PLATFORM_ADMIN' || user.jobRole === 'HQ_ADMIN';
}

export function IdmsBadge({ status }: { status: IdmsStatus | undefined }) {
  if (!status) return null;
  return <span className={`badge tone-${TONE[status]} idms-badge`} title={HINT[status]}>{IDMS_LABEL[status]}</span>;
}

/** Badge plus the one allowed forward step, for users whose role may change the lifecycle. */
export function IdmsControl({ kind, id, status, onChanged, compact = false }: { kind: IdmsKind; id: string; status: IdmsStatus; onChanged: () => void; compact?: boolean }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const next = NEXT[status];
  const allowed = next && canTransition(userContext(), kind);
  const go = () => {
    if (!next || (next.confirm && !window.confirm(next.confirm))) return;
    void run(() => api.idmsTransition(kind, id, next.to)).then((r) => r && (notify(tf("Lifecycle: {status}", { status: IDMS_LABEL[r.idmsStatus] })), onChanged()));
  };
  return (
    <span className="idms-control">
      <IdmsBadge status={status} />
      {allowed && (
        <button className={compact ? 'link-button' : 'secondary small'} disabled={busy} onClick={go}>
          {next.label}
        </button>
      )}
      {error && <ErrorText error={error} />}
    </span>
  );
}

const CLASS_LABEL: Record<DocumentClass, string> = live(() => ({
  invoice: t("Invoices"),
  agreement: t("Agreements"),
  financial_plan: t("Financial plans"),
  office_doc: t("Office documents"),
  visit_report: t("Visit reports"),
  survey_response: t("Survey responses"),
}));

const MODE_LABEL: Record<ErasureMode, string> = live(() => ({ pseudonymize: t("Anonymise (keep amounts)"), hard_delete: t("Delete completely") }));

export function RetentionView() {
  const user = userContext();
  const { notify } = useShell();
  const policies = useLoad(() => api.retentionPolicies(), []);
  const runner = useAction();
  const [result, setResult] = useState<RetentionRun | null>(null);
  const manage = canManageRetention(user);
  const runNow = () => {
    if (!window.confirm(t("Run the retention job now? Archived records past their retention period are expired and their personal data is erased. This cannot be undone."))) return;
    void runner.run(() => api.runRetention()).then((r) => r && (setResult(r), notify(t("Retention job finished")), policies.reload()));
  };
  return (
    <ViewFrame
      title={t("Retention & erasure")}
      crumbs={[{ label: t("Symphony"), href: '#/symphony' }, { label: t("Retention & erasure") }]}
      subtitle={t("How long each kind of record is kept after it is archived, and how personal data is erased afterwards (GDPR Art. 17). The job runs every day; every erasure is sealed in the activity log.")}
      actions={manage && <button className="secondary" disabled={runner.busy} onClick={runNow}>{runner.busy ? t("Running…") : t("Run now")}</button>}
    >
      <ErrorText error={runner.error} />
      {result && (
        <p className="callout good">
          {tf("Done: {expired} expired, {pseudonymized} anonymised, {deleted} deleted.", { expired: String(result.expired), pseudonymized: String(result.pseudonymized), deleted: String(result.deleted) })}
        </p>
      )}
      <div className="card-panel">
        <h3>{t("Lifecycle")}</h3>
        <p className="muted">{t("Office documents, agreements, financial plans and invoices move one step at a time:")}</p>
        <p className="idms-steps">
          {(['DRAFT', 'IN_REVIEW', 'FINAL_LOCKED', 'ARCHIVED_WORM', 'EXPIRED_PURGE'] as IdmsStatus[]).map((s, i) => (
            <span key={s}>{i > 0 && ' → '}<IdmsBadge status={s} /></span>
          ))}
        </p>
        <p className="muted small">{t("Final and archived records can't be edited, renamed or deleted, and open read-only in Agera Office. Only the retention job sets Expired.")}</p>
      </div>
      {!policies.data ? <Loading error={policies.error} /> : (
        <table className="grid">
          <thead>
            <tr>
              <th>{t("Record type")}</th>
              <th>{t("Keep after archiving (years)")}</th>
              <th>{t("Erase personal data after (days)")}</th>
              <th>{t("Erasure")}</th>
              <th>{t("Last changed")}</th>
              {manage && <th />}
            </tr>
          </thead>
          <tbody>
            {policies.data.map((p) => <PolicyRow key={p.documentClass} policy={p} manage={manage} onSaved={policies.reload} />)}
          </tbody>
        </table>
      )}
      {!manage && <p className="muted small">{t("Only HQ administrators can change these rules.")}</p>}
    </ViewFrame>
  );
}

function PolicyRow({ policy, manage, onSaved }: { policy: RetentionPolicy; manage: boolean; onSaved: () => void }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const [years, setYears] = useState(String(policy.wormRetentionYears));
  const [days, setDays] = useState(policy.autoPurgeDays === null ? '' : String(policy.autoPurgeDays));
  const [mode, setMode] = useState<ErasureMode>(policy.erasureMode);
  const dirty = years !== String(policy.wormRetentionYears) || days !== (policy.autoPurgeDays === null ? '' : String(policy.autoPurgeDays)) || mode !== policy.erasureMode;
  const label = CLASS_LABEL[policy.documentClass];
  const save = () =>
    void run(() => api.updateRetentionPolicy(policy.documentClass, { wormRetentionYears: Number(years), autoPurgeDays: days.trim() === '' ? null : Number(days), erasureMode: mode }))
      .then((r) => r && (notify(tf("Retention rule saved: {type}", { type: label })), onSaved()));
  return (
    <tr>
      <td>
        <strong>{label}</strong>
        <div className="muted small">{policy.lifecycle ? t("Counted from the archive date") : t("No lifecycle: counted from the creation date")}</div>
      </td>
      <td>{manage ? <input type="number" min={1} max={100} value={years} aria-label={tf("Years to keep: {type}", { type: label })} onChange={(e) => setYears(e.target.value)} style={{ width: '6rem' }} /> : policy.wormRetentionYears}</td>
      <td>
        {manage
          ? <input type="number" min={1} max={36500} value={days} placeholder={t("Off")} aria-label={tf("Days until erasure: {type}", { type: label })} onChange={(e) => setDays(e.target.value)} style={{ width: '7rem' }} />
          : policy.autoPurgeDays ?? t("Off")}
      </td>
      <td>
        {manage
          ? (
            <select value={mode} aria-label={tf("Erasure: {type}", { type: label })} onChange={(e) => setMode(e.target.value as ErasureMode)}>
              <option value="pseudonymize">{MODE_LABEL.pseudonymize}</option>
              <option value="hard_delete">{MODE_LABEL.hard_delete}</option>
            </select>
          )
          : MODE_LABEL[policy.erasureMode]}
      </td>
      <td>{formatDateTime(policy.updatedAt)}<div className="muted small">{policy.updatedByName ?? t("Default")}</div></td>
      {manage && (
        <td className="row-actions">
          <button className="primary small" disabled={!dirty || busy} onClick={save}>{t("Save")}</button>
          {error && <ErrorText error={error} />}
        </td>
      )}
    </tr>
  );
}
